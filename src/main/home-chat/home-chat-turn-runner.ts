import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { HomeChatEntry, HomeChatNoticeSource } from '../../shared/home-chat/home-chat-types'
import { mergeHomeChatEntry } from '../../shared/home-chat/home-chat-entry-merge'
import type { HomeChatAccountProvider } from './home-chat-accounts'
import type { HomeChatApprovals } from './home-chat-approvals'
import { HomeChatEntryWriter } from './home-chat-entry-writer'
import type { HomeChatStore, StoredHomeChat } from './home-chat-store'
import { withTranscriptPreamble } from './home-chat-transcript-preamble'
import type { HomeChatBackendSession } from './backends/home-chat-backend'
import { createClaudeCodeSession } from './backends/claude-code/claude-code-session'
import { createOpenAiCompatibleSession } from './backends/openai/openai-compatible-session'
import type { OpenAiChatMessage } from './backends/openai/openai-stream-accumulator'
import type { HomeChatMachineProvider } from './machines/home-chat-machine-types'
import type { HomeChatAssistantServices } from './home-chat-assistant-services'
import type { HomeChatToolContext } from './tools/home-chat-tool-executor'
import { runHomeChatToolCall } from './tools/home-chat-tool-runner'

export type HomeChatTurnRunnerDeps = {
  rootDir: string
  store: HomeChatStore
  accounts: HomeChatAccountProvider
  machines: HomeChatMachineProvider
  approvals: HomeChatApprovals
  runOrcaCli: HomeChatToolContext['runOrcaCli']
  services: HomeChatAssistantServices
  systemPrompt: (chatId: string) => Promise<string>
  onTurnEnded: (chatId: string, failed: boolean) => void
  /** The chat changed: persist and broadcast it. */
  onChatChanged: (stored: StoredHomeChat, entry?: HomeChatEntry) => void
}

type TurnInput =
  | { kind: 'user'; text: string }
  | { kind: 'wake'; source: HomeChatNoticeSource; text: string }

type LiveSession = {
  key: string
  session: HomeChatBackendSession
  /** The backend has no memory of this chat's earlier turns yet. */
  needsPreamble: boolean
}

const TITLE_LENGTH = 60

function sessionKey(stored: StoredHomeChat): string {
  const { backend, accountId, model } = stored.chat
  return `${backend}\0${accountId ?? ''}\0${model ?? ''}`
}

/** Owns each chat's backend session and its one running turn. */
export class HomeChatTurnRunner {
  private readonly sessions = new Map<string, LiveSession>()
  private readonly running = new Map<string, AbortController>()
  private readonly pendingWakes = new Map<string, TurnInput[]>()

  constructor(private readonly deps: HomeChatTurnRunnerDeps) {}

  isRunning(chatId: string): boolean {
    return this.running.has(chatId)
  }

  writerFor(chatId: string): HomeChatEntryWriter {
    return new HomeChatEntryWriter((entry) => {
      const stored = this.deps.store.get(chatId)
      if (!stored) {
        return
      }
      const entries = mergeHomeChatEntry(stored.chat.entries, entry)
      this.deps.onChatChanged(
        { ...stored, chat: { ...stored.chat, entries, updatedAt: Date.now() } },
        entry
      )
    })
  }

  /** Starts the turn and returns once it is accepted; the answer streams as entries. */
  send(chatId: string, text: string): void {
    const stored = this.deps.store.get(chatId)
    if (!stored) {
      throw new Error('This chat no longer exists')
    }
    if (this.running.has(chatId)) {
      throw new Error('Wait for the current answer or stop it first')
    }
    const firstMessage = !stored.chat.entries.some((entry) => entry.kind === 'user')
    const title = firstMessage
      ? text.trim().replace(/\s+/g, ' ').slice(0, TITLE_LENGTH)
      : stored.chat.title
    this.start(stored, { kind: 'user', text }, title)
  }

  /** Something finished in the background: show it, then let the assistant react now or after the current turn. */
  wake(chatId: string, source: HomeChatNoticeSource, text: string): void {
    const stored = this.deps.store.get(chatId)
    if (!stored) {
      return
    }
    this.writerFor(chatId).create({ kind: 'notice', source, text })
    const input: TurnInput = { kind: 'wake', source, text }
    if (this.running.has(chatId)) {
      this.pendingWakes.set(chatId, [...(this.pendingWakes.get(chatId) ?? []), input])
      return
    }
    this.start(stored, input, stored.chat.title)
  }

  private start(stored: StoredHomeChat, input: TurnInput, title: string): void {
    const controller = new AbortController()
    this.running.set(stored.chat.id, controller)
    this.deps.onChatChanged({ ...stored, chat: { ...stored.chat, status: 'running', title } })
    void this.runTurn(stored.chat.id, input, controller)
  }

  private startNextWake(chatId: string): void {
    const queue = this.pendingWakes.get(chatId) ?? []
    this.pendingWakes.delete(chatId)
    const stored = this.deps.store.get(chatId)
    if (queue.length === 0 || !stored) {
      return
    }
    const text = queue.map((item) => item.text).join('\n\n')
    const source = queue.length === 1 && queue[0].kind === 'wake' ? queue[0].source : 'job'
    this.start(stored, { kind: 'wake', source, text }, stored.chat.title)
  }

  stop(chatId: string): void {
    this.pendingWakes.delete(chatId)
    this.running.get(chatId)?.abort()
    this.deps.approvals.declineAll(chatId)
  }

  async closeSession(chatId: string): Promise<void> {
    this.stop(chatId)
    const live = this.sessions.get(chatId)
    this.sessions.delete(chatId)
    await live?.session.close().catch(() => undefined)
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((chatId) => this.closeSession(chatId)))
  }

  private async runTurn(
    chatId: string,
    input: TurnInput,
    controller: AbortController
  ): Promise<void> {
    const earlier = this.deps.store.get(chatId)?.chat.entries ?? []
    const writer = this.writerFor(chatId)
    const user =
      input.kind === 'user'
        ? writer.create({ kind: 'user', text: input.text, delivery: 'sending' })
        : null
    const text =
      input.kind === 'user'
        ? input.text
        : `<seal_notification source="${input.source}">\n${input.text}\n</seal_notification>\nThis arrived on its own, not from the user. Verify the outcome if it matters, then tell the user briefly what happened and what (if anything) you did next.`
    let failed = false
    try {
      const live = await this.ensureSession(chatId)
      const prompt = live.needsPreamble ? withTranscriptPreamble(earlier, text) : text
      live.needsPreamble = false
      user?.update({ delivery: 'delivered' })
      const systemPrompt = await this.deps.systemPrompt(chatId)
      await live.session.runTurn(prompt, {
        writer,
        systemPrompt,
        signal: controller.signal,
        runTool: (tool, input) =>
          runHomeChatToolCall(tool, input, {
            chatId,
            writer,
            approvals: this.deps.approvals,
            machines: this.deps.machines,
            runOrcaCli: this.deps.runOrcaCli,
            services: this.deps.services,
            signal: controller.signal
          })
      })
    } catch (error) {
      if (user?.current().delivery === 'sending') {
        user.update({ delivery: 'failed' })
      }
      if (controller.signal.aborted) {
        writer.create({ kind: 'progress', text: 'Stopped.' })
      } else {
        failed = true
        writer.create({
          kind: 'error',
          text: error instanceof Error ? error.message : String(error)
        })
        // A broken process is replaced on the next message.
        await this.closeSessionOnly(chatId)
      }
    } finally {
      this.running.delete(chatId)
      this.deps.approvals.declineAll(chatId)
      const stored = this.deps.store.get(chatId)
      if (stored) {
        this.deps.onChatChanged({
          ...stored,
          chat: { ...stored.chat, status: failed ? 'error' : 'idle', updatedAt: Date.now() }
        })
      }
      this.deps.onTurnEnded(chatId, failed || controller.signal.aborted)
      if (!controller.signal.aborted) {
        this.startNextWake(chatId)
      }
    }
  }

  private async closeSessionOnly(chatId: string): Promise<void> {
    const live = this.sessions.get(chatId)
    this.sessions.delete(chatId)
    await live?.session.close().catch(() => undefined)
  }

  private async ensureSession(chatId: string): Promise<LiveSession> {
    const stored = this.deps.store.get(chatId)
    if (!stored) {
      throw new Error('This chat no longer exists')
    }
    const key = sessionKey(stored)
    const existing = this.sessions.get(chatId)
    if (existing?.key === key) {
      return existing
    }
    await this.closeSessionOnly(chatId)
    const { backendState } = stored
    const remembers =
      stored.chat.backend === 'claude-code'
        ? Boolean(backendState.claudeSessionId)
        : (backendState.openaiMessages?.length ?? 0) > 0
    const live: LiveSession = {
      key,
      session: await this.createSession(chatId, stored),
      needsPreamble: !remembers
    }
    this.sessions.set(chatId, live)
    return live
  }

  private updateBackendState(chatId: string, patch: StoredHomeChat['backendState']): void {
    const stored = this.deps.store.get(chatId)
    if (stored) {
      this.deps.store.put({ ...stored, backendState: { ...stored.backendState, ...patch } })
    }
  }

  private async createSession(
    chatId: string,
    stored: StoredHomeChat
  ): Promise<HomeChatBackendSession> {
    if (stored.chat.backend === 'claude-code') {
      const cwd = join(this.deps.rootDir, 'workspace')
      await mkdir(cwd, { recursive: true })
      return createClaudeCodeSession({
        cwd,
        claudeConfigDir: await this.deps.accounts.claudeConfigDir(stored.chat.accountId),
        resumeSessionId: stored.backendState.claudeSessionId ?? null,
        onSessionId: (claudeSessionId) => this.updateBackendState(chatId, { claudeSessionId })
      })
    }
    const settings = this.deps.store.readSettings()
    return createOpenAiCompatibleSession({
      baseUrl: settings.openai.baseUrl,
      model: stored.chat.model || settings.openai.model,
      apiKey: this.deps.store.readApiKey(),
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only this backend writes openaiMessages.
      history: (stored.backendState.openaiMessages ?? []) as OpenAiChatMessage[],
      onHistory: (history) => this.updateBackendState(chatId, { openaiMessages: [...history] })
    })
  }
}
