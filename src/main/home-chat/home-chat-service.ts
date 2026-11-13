import type {
  HomeChat,
  HomeChatAccountOption,
  HomeChatCreateArgs,
  HomeChatEvent,
  HomeChatMachineOption,
  HomeChatSettings,
  HomeChatSettingsUpdate,
  HomeChatSummary,
  HomeChatUpdateArgs
} from '../../shared/home-chat/home-chat-types'
import type { HomeChatMemory } from '../../shared/home-chat/home-chat-memory-types'
import type { HomeChatAccountProvider } from './home-chat-accounts'
import { HomeChatApprovals } from './home-chat-approvals'
import {
  createHomeChatAssistantRuntime,
  type HomeChatAssistantRuntime,
  type HomeChatRuntimeDeps
} from './home-chat-assistant-runtime'
import type { HomeChatSealAccess } from './home-chat-assistant-services'
import { systemPromptForChat } from './home-chat-prompt-context'
import { mergeHomeChatSettings, type HomeChatSettingsStore } from './home-chat-settings-store'
import type { HomeChatWorkerHost } from './delegation/home-chat-subagents'
import type { HomeChatDriver } from './drivers/home-chat-driver'
import { homeChatDriverFor, modelChangeNote } from './drivers/home-chat-driver-selection'
import { HomeChatTurnEngine } from './engine/home-chat-turn-engine'
import type { HomeChatThread } from './thread/home-chat-thread'
import type { HomeChatThreadStore } from './thread/home-chat-thread-store'
import { homeChatThreadSummary } from './thread/home-chat-thread-summary'

export type HomeChatServiceDeps = Pick<
  HomeChatRuntimeDeps,
  'createMachines' | 'runOrcaCli' | 'repos'
> & {
  rootDir: string
  threads: HomeChatThreadStore
  settings: Pick<HomeChatSettingsStore, 'read' | 'write' | 'readApiKey' | 'readSearchApiKey'>
  accounts: HomeChatAccountProvider
  seal: Omit<HomeChatSealAccess, 'open'>
  emit: (event: HomeChatEvent) => void
  /** Replaces the model drivers, for tests. */
  driverFor?: (thread: HomeChatThread) => Promise<HomeChatDriver>
}

export class HomeChatService {
  private readonly approvals = new HomeChatApprovals((chatId) =>
    this.notifyParentOfApproval(chatId)
  )
  private readonly engine: HomeChatTurnEngine
  private readonly runtime: HomeChatAssistantRuntime

  constructor(private readonly deps: HomeChatServiceDeps) {
    this.runtime = createHomeChatAssistantRuntime({
      rootDir: deps.rootDir,
      createMachines: deps.createMachines,
      runOrcaCli: deps.runOrcaCli,
      repos: deps.repos,
      webConfig: () => {
        const { web } = deps.settings.read()
        return {
          searchProvider: web.searchProvider,
          searxngUrl: web.searxngUrl,
          apiKey: deps.settings.readSearchApiKey()
        }
      },
      wake: (chatId, source, text) => this.engine.wake(chatId, source, text),
      memoryChanged: () => deps.emit({ type: 'memory' }),
      workers: this.workerHost(),
      seal: { ...deps.seal, open: (target) => deps.emit({ type: 'open', target }) }
    })
    const { services, machines } = this.runtime
    this.engine = new HomeChatTurnEngine({
      thread: (chatId) => deps.threads.get(chatId),
      approvals: this.approvals,
      machines,
      runOrcaCli: deps.runOrcaCli,
      services,
      driverFor: deps.driverFor ?? ((thread) => homeChatDriverFor(thread, deps)),
      systemPrompt: (thread) =>
        systemPromptForChat(services, machines, {
          chatId: thread.id,
          isWorker: Boolean(thread.meta.parentChatId),
          lastMachine: thread.meta.lastMachine ?? null
        }),
      onTurnEnded: (chatId, failed) => {
        if (deps.threads.get(chatId)?.meta.parentChatId) {
          services.subagents.workerTurnEnded(chatId, failed)
        }
      },
      publishEntry: (chatId, entry) => deps.emit({ type: 'entry', chatId, entry }),
      publishSummary: (thread) => this.publish(thread)
    })
  }

  /** Loads jobs, subagents and routines; missed routine runs and finished jobs report right away. */
  start(): Promise<void> {
    return this.runtime.load()
  }

  listChats(): HomeChatSummary[] {
    return this.deps.threads.list().map(homeChatThreadSummary)
  }

  getChat(chatId: string): HomeChat | null {
    const thread = this.deps.threads.get(chatId)
    return thread ? { ...homeChatThreadSummary(thread), entries: [...thread.entries] } : null
  }

  createChat(args: HomeChatCreateArgs = {}, parentChatId?: string, title?: string): HomeChat {
    const thread = this.deps.threads.create({
      backend: args.backend ?? this.deps.settings.read().defaultBackend,
      accountId: args.accountId ?? null,
      model: args.model ?? null,
      ...(parentChatId ? { parentChatId } : {}),
      ...(title ? { title } : {})
    })
    this.publish(thread)
    return { ...homeChatThreadSummary(thread), entries: [] }
  }

  async updateChat(args: HomeChatUpdateArgs): Promise<HomeChatSummary> {
    const thread = this.require(args.chatId)
    const before = thread.meta
    const next = {
      title: args.title !== undefined ? args.title.trim() || before.title : before.title,
      backend: args.backend ?? before.backend,
      accountId: args.accountId !== undefined ? args.accountId : before.accountId,
      model: args.model !== undefined ? args.model?.trim() || null : before.model
    }
    const changesModel =
      next.backend !== before.backend ||
      next.accountId !== before.accountId ||
      next.model !== before.model
    if (changesModel && this.engine.isRunning(args.chatId)) {
      throw new Error('Stop the current answer before switching model source, account or model')
    }
    // Sizes measured for the old model say nothing about the new one.
    thread.updateMeta({
      ...next,
      ...(changesModel
        ? { contextTokens: undefined, contextUsed: undefined, contextWindow: undefined }
        : {})
    })
    if (changesModel && thread.items.length > 0) {
      this.engine.note(args.chatId, {
        kind: 'progress',
        text: await modelChangeNote(thread, this.deps)
      })
    }
    this.publish(thread)
    return homeChatThreadSummary(thread)
  }

  async deleteChat(chatId: string): Promise<void> {
    this.engine.stop(chatId)
    const { services } = this.runtime
    services.routines.deleteForChat(chatId)
    for (const item of services.subagents.list(chatId).filter((sub) => sub.state === 'running')) {
      await services.subagents.stop(item.id).catch(() => undefined)
    }
    await this.deps.threads.delete(chatId)
    await services.attachments.deleteChat(chatId)
    this.deps.emit({ type: 'deleted', chatId })
  }

  send(chatId: string, text: string): void {
    const trimmed = text.trim()
    if (!trimmed) {
      throw new Error('Type a message first')
    }
    this.engine.send(chatId, trimmed)
  }

  stop(chatId: string): void {
    this.engine.stop(chatId)
  }

  /** Summarize the older part of the thread for the model now. False when there is nothing to summarize. */
  compact(chatId: string): Promise<boolean> {
    return this.engine.compactNow(chatId)
  }

  respondApproval(chatId: string, entryId: string, approved: boolean): boolean {
    return this.approvals.respond(chatId, entryId, approved)
  }

  getSettings(): HomeChatSettings {
    return this.deps.settings.read()
  }

  updateSettings(update: HomeChatSettingsUpdate): HomeChatSettings {
    const next = mergeHomeChatSettings(this.deps.settings.read(), update)
    this.deps.settings.write(next, {
      apiKey: update.openai?.apiKey,
      searchApiKey: update.web?.apiKey
    })
    return this.deps.settings.read()
  }

  getMemory(): HomeChatMemory {
    return this.runtime.services.memory.get()
  }

  updateMemory(memory: HomeChatMemory): HomeChatMemory {
    return this.runtime.services.memory.replace(memory)
  }

  readAttachment(
    chatId: string,
    attachmentId: string
  ): Promise<{ mimeType: string; base64: string }> {
    return this.runtime.services.attachments.read(chatId, attachmentId)
  }

  attachmentPath(chatId: string, attachmentId: string): Promise<string> {
    return this.runtime.services.attachments.pathOf(chatId, attachmentId)
  }

  saveAttachment(chatId: string, attachmentId: string, destination: string): Promise<void> {
    return this.runtime.services.attachments.saveAs(chatId, attachmentId, destination)
  }

  listAccounts(): Promise<HomeChatAccountOption[]> {
    return this.deps.accounts.list()
  }

  /** The machines the assistant can act on, as the Machines page lists them. */
  async listMachines(): Promise<HomeChatMachineOption[]> {
    return (await this.runtime.machines.list()).map((machine) => ({
      id: machine.id,
      label: machine.label,
      kind: machine.kind,
      status: machine.status,
      ...(machine.address ? { address: machine.address } : {})
    }))
  }

  async dispose(): Promise<void> {
    this.runtime.dispose()
    this.engine.stopAll()
    await this.deps.threads.flushAll()
  }

  private workerHost(): HomeChatWorkerHost {
    return {
      create: (parentChatId, title) => {
        const parent = this.require(parentChatId).meta
        return this.createChat(
          { backend: parent.backend, accountId: parent.accountId, model: parent.model },
          parentChatId,
          `Worker: ${title}`.slice(0, 80)
        ).id
      },
      send: (workerChatId, text) => this.engine.send(workerChatId, text),
      stop: (workerChatId) => this.engine.stop(workerChatId),
      isRunning: (workerChatId) => this.engine.isRunning(workerChatId),
      lastAnswer: (workerChatId) => {
        const entries = this.deps.threads.get(workerChatId)?.entries ?? []
        const last = entries.findLast((entry) => entry.kind === 'assistant' && entry.text.trim())
        return last?.kind === 'assistant' ? last.text : ''
      }
    }
  }

  /** A worker chat runs unattended, so its approval cards are surfaced in the chat that started it. */
  private notifyParentOfApproval(chatId: string): void {
    const thread = this.deps.threads.get(chatId)
    const parentId = thread?.meta.parentChatId
    if (thread && parentId) {
      this.engine.note(parentId, {
        kind: 'notice',
        source: 'approval',
        text: `Worker "${thread.meta.title}" is waiting for your approval. Open it from the chat list to approve or decline.`
      })
    }
  }

  private require(chatId: string): HomeChatThread {
    const thread = this.deps.threads.get(chatId)
    if (!thread) {
      throw new Error('This chat no longer exists')
    }
    return thread
  }

  private publish(thread: HomeChatThread): void {
    this.deps.emit({ type: 'summary', chat: homeChatThreadSummary(thread) })
  }
}
