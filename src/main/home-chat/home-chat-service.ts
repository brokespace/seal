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
import type { HomeChatAccountProvider } from './home-chat-accounts'
import { HomeChatApprovals } from './home-chat-approvals'
import type { HomeChatStore, StoredHomeChat } from './home-chat-store'
import { HomeChatTurnRunner } from './home-chat-turn-runner'
import type { HomeChatMachineProvider } from './machines/home-chat-machine-types'
import type { HomeChatToolContext } from './tools/home-chat-tool-executor'

export type HomeChatServiceDeps = {
  rootDir: string
  store: HomeChatStore
  accounts: HomeChatAccountProvider
  machines: HomeChatMachineProvider
  runOrcaCli: HomeChatToolContext['runOrcaCli']
  emit: (event: HomeChatEvent) => void
}

function summary({ entries: _entries, ...rest }: HomeChat): HomeChatSummary {
  return rest
}

export class HomeChatService {
  private readonly approvals = new HomeChatApprovals()
  private readonly turns: HomeChatTurnRunner

  constructor(private readonly deps: HomeChatServiceDeps) {
    this.turns = new HomeChatTurnRunner({
      rootDir: deps.rootDir,
      store: deps.store,
      accounts: deps.accounts,
      machines: deps.machines,
      approvals: this.approvals,
      runOrcaCli: deps.runOrcaCli,
      onChatChanged: (stored, entry) => this.publish(stored, entry)
    })
  }

  listChats(): HomeChatSummary[] {
    return this.deps.store.list().map((stored) => summary(stored.chat))
  }

  getChat(chatId: string): HomeChat | null {
    return this.deps.store.get(chatId)?.chat ?? null
  }

  createChat(args: HomeChatCreateArgs = {}): HomeChat {
    const now = Date.now()
    const chat: HomeChat = {
      id: randomUUID(),
      title: 'New chat',
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
    this.deps.store.delete(chatId)
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
      }
    }
    this.deps.store.writeSettings(next, update.openai?.apiKey)
    return this.deps.store.readSettings()
  }

  listAccounts(): Promise<HomeChatAccountOption[]> {
    return this.deps.accounts.list()
  }

  async dispose(): Promise<void> {
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
    return `Now answering with Claude Code on ${account?.label ?? 'the default login'}.`
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
