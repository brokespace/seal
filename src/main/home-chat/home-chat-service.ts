import { randomUUID } from 'node:crypto'
import type {
  HomeChat,
  HomeChatAccountOption,
  HomeChatCreateArgs,
  HomeChatEntry,
  HomeChatEvent,
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
import { systemPromptForChat } from './home-chat-prompt-context'
import type { HomeChatStore, StoredHomeChat } from './home-chat-store'
import { HomeChatTurnRunner } from './home-chat-turn-runner'
import type { HomeChatWorkerHost } from './delegation/home-chat-subagents'

export type HomeChatServiceDeps = Pick<
  HomeChatRuntimeDeps,
  'createMachines' | 'runOrcaCli' | 'repos'
> & {
  rootDir: string
  store: HomeChatStore
  accounts: HomeChatAccountProvider
  emit: (event: HomeChatEvent) => void
}

function summary({ entries: _entries, ...rest }: HomeChat): HomeChatSummary {
  return rest
}

export class HomeChatService {
  private readonly approvals = new HomeChatApprovals((chatId) =>
    this.notifyParentOfApproval(chatId)
  )
  private readonly turns: HomeChatTurnRunner
  private readonly runtime: HomeChatAssistantRuntime

  constructor(private readonly deps: HomeChatServiceDeps) {
    this.runtime = createHomeChatAssistantRuntime({
      rootDir: deps.rootDir,
      createMachines: deps.createMachines,
      runOrcaCli: deps.runOrcaCli,
      repos: deps.repos,
      webConfig: () => {
        const { web } = deps.store.readSettings()
        return {
          searchProvider: web.searchProvider,
          searxngUrl: web.searxngUrl,
          apiKey: deps.store.readSearchApiKey()
        }
      },
      wake: (chatId, source, text) => this.turns.wake(chatId, source, text),
      memoryChanged: () => deps.emit({ type: 'memory' }),
      workers: this.workerHost()
    })
    const { services, machines } = this.runtime
    this.turns = new HomeChatTurnRunner({
      rootDir: deps.rootDir,
      store: deps.store,
      accounts: deps.accounts,
      machines,
      approvals: this.approvals,
      runOrcaCli: deps.runOrcaCli,
      services,
      systemPrompt: (chatId) =>
        systemPromptForChat(
          services,
          machines,
          chatId,
          Boolean(deps.store.get(chatId)?.chat.parentChatId)
        ),
      onTurnEnded: (chatId, failed) => {
        if (deps.store.get(chatId)?.chat.parentChatId) {
          services.subagents.workerTurnEnded(chatId, failed)
        }
      },
      onChatChanged: (stored, entry) => this.publish(stored, entry)
    })
  }

  /** Loads jobs, subagents and routines; missed routine runs and finished jobs report right away. */
  start(): Promise<void> {
    return this.runtime.load()
  }

  listChats(): HomeChatSummary[] {
    return this.deps.store.list().map((stored) => summary(stored.chat))
  }

  getChat(chatId: string): HomeChat | null {
    return this.deps.store.get(chatId)?.chat ?? null
  }

  createChat(args: HomeChatCreateArgs = {}, parentChatId?: string): HomeChat {
    const now = Date.now()
    const chat: HomeChat = {
      id: randomUUID(),
      title: 'New chat',
      ...(parentChatId ? { parentChatId } : {}),
      backend: args.backend ?? this.deps.store.readSettings().defaultBackend,
      accountId: args.accountId ?? null,
      model: args.model ?? null,
      status: 'idle',
      createdAt: now,
      updatedAt: now,
      entries: []
    }
    this.publish({ chat, backendState: {} })
    return chat
  }

  async updateChat(args: HomeChatUpdateArgs): Promise<HomeChatSummary> {
    const stored = this.require(args.chatId)
    const next: HomeChat = {
      ...stored.chat,
      ...(args.title !== undefined ? { title: args.title.trim() || stored.chat.title } : {}),
      ...(args.backend !== undefined ? { backend: args.backend } : {}),
      ...(args.accountId !== undefined ? { accountId: args.accountId } : {}),
      ...(args.model !== undefined ? { model: args.model?.trim() || null } : {})
    }
    const changesRuntime =
      next.backend !== stored.chat.backend ||
      next.accountId !== stored.chat.accountId ||
      next.model !== stored.chat.model
    if (changesRuntime && this.turns.isRunning(args.chatId)) {
      throw new Error('Stop the current answer before switching backend, account or model')
    }
    // Another account's Claude home cannot resume this session, so it starts fresh.
    const backendState =
      next.accountId !== stored.chat.accountId
        ? { ...stored.backendState, claudeSessionId: undefined }
        : stored.backendState
    if (changesRuntime) {
      await this.turns.closeSession(args.chatId)
    }
    this.publish({ chat: next, backendState })
    if (changesRuntime && stored.chat.entries.length > 0) {
      this.turns.writerFor(args.chatId).create({
        kind: 'progress',
        text: await this.runtimeChangeNote(next)
      })
    }
    return summary(next)
  }

  async deleteChat(chatId: string): Promise<void> {
    await this.turns.closeSession(chatId)
    const { services } = this.runtime
    services.routines.deleteForChat(chatId)
    for (const item of services.subagents.list(chatId).filter((sub) => sub.state === 'running')) {
      await services.subagents.stop(item.id).catch(() => undefined)
    }
    this.deps.store.delete(chatId)
    await services.attachments.deleteChat(chatId)
    this.deps.emit({ type: 'deleted', chatId })
  }

  send(chatId: string, text: string): void {
    const trimmed = text.trim()
    if (!trimmed) {
      throw new Error('Type a message first')
    }
    this.turns.send(chatId, trimmed)
  }

  stop(chatId: string): void {
    this.turns.stop(chatId)
  }

  respondApproval(chatId: string, entryId: string, approved: boolean): boolean {
    return this.approvals.respond(chatId, entryId, approved)
  }

  getSettings(): HomeChatSettings {
    return this.deps.store.readSettings()
  }

  updateSettings(update: HomeChatSettingsUpdate): HomeChatSettings {
    const current = this.deps.store.readSettings()
    const next: HomeChatSettings = {
      defaultBackend: update.defaultBackend ?? current.defaultBackend,
      openai: {
        ...current.openai,
        ...(update.openai?.baseUrl !== undefined ? { baseUrl: update.openai.baseUrl.trim() } : {}),
        ...(update.openai?.model !== undefined ? { model: update.openai.model.trim() } : {})
      },
      web: {
        ...current.web,
        ...(update.web?.searchProvider ? { searchProvider: update.web.searchProvider } : {}),
        ...(update.web?.searxngUrl !== undefined
          ? { searxngUrl: update.web.searxngUrl.trim() }
          : {})
      }
    }
    this.deps.store.writeSettings(next, {
      apiKey: update.openai?.apiKey,
      searchApiKey: update.web?.apiKey
    })
    return this.deps.store.readSettings()
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

  async dispose(): Promise<void> {
    this.runtime.dispose()
    await this.turns.closeAll()
    this.deps.store.flushAll()
  }

  private async runtimeChangeNote(chat: HomeChat): Promise<string> {
    if (chat.backend === 'openai-compatible') {
      const model = chat.model || this.deps.store.readSettings().openai.model || 'the default model'
      return `Now answering with ${model} through the model API.`
    }
    const accounts = await this.deps.accounts.list().catch(() => [])
    const account = accounts.find((option) => option.id === chat.accountId)
    return `Now answering with Claude Code on ${account?.label ?? 'the current account'}.`
  }

  private workerHost(): HomeChatWorkerHost {
    return {
      create: (parentChatId, title) => {
        const parent = this.require(parentChatId).chat
        const chat = this.createChat(
          { backend: parent.backend, accountId: parent.accountId, model: parent.model },
          parentChatId
        )
        this.publish({
          chat: { ...chat, title: `Worker: ${title}`.slice(0, 80) },
          backendState: {}
        })
        return chat.id
      },
      send: (workerChatId, text) => this.turns.send(workerChatId, text),
      stop: (workerChatId) => this.turns.stop(workerChatId),
      isRunning: (workerChatId) => this.turns.isRunning(workerChatId),
      lastAnswer: (workerChatId) => {
        const entries = this.deps.store.get(workerChatId)?.chat.entries ?? []
        const last = entries.findLast((entry) => entry.kind === 'assistant' && entry.text.trim())
        return last?.kind === 'assistant' ? last.text : ''
      }
    }
  }

  /** A worker chat runs unattended, so its approval cards are surfaced in the chat that started it. */
  private notifyParentOfApproval(chatId: string): void {
    const stored = this.deps.store.get(chatId)
    const parentId = stored?.chat.parentChatId
    if (parentId && this.deps.store.get(parentId)) {
      this.turns.writerFor(parentId).create({
        kind: 'notice',
        source: 'approval',
        text: `Worker "${stored.chat.title}" is waiting for your approval. Open it from the chat list to approve or decline.`
      })
    }
  }

  private require(chatId: string): StoredHomeChat {
    const stored = this.deps.store.get(chatId)
    if (!stored) {
      throw new Error('This chat no longer exists')
    }
    return stored
  }

  private publish(stored: StoredHomeChat, entry?: HomeChatEntry): void {
    this.deps.store.put(stored)
    if (entry) {
      this.deps.emit({ type: 'entry', chatId: stored.chat.id, entry })
    } else {
      this.deps.emit({ type: 'summary', chat: summary(stored.chat) })
    }
  }
}
