import type { HomeChatEntry, HomeChatNoticeSource } from '../../../shared/home-chat/home-chat-types'
import type { HomeChatDriver } from '../drivers/home-chat-driver'
import type { HomeChatApprovals } from '../home-chat-approvals'
import type { HomeChatAssistantServices } from '../home-chat-assistant-services'
import type { HomeChatMachineProvider } from '../machines/home-chat-machine-types'
import type { HomeChatThread } from '../thread/home-chat-thread'
import type { HomeChatThreadEvent } from '../thread/home-chat-thread-items'
import type { HomeChatToolContext } from '../tools/home-chat-tool-executor'
import { runHomeChatToolCall } from '../tools/home-chat-tool-runner'
import { RepeatGuard } from './home-chat-repeat-guard'
import { compactHomeChatThread } from './home-chat-thread-compaction'
import { HomeChatTurnRecorder } from './home-chat-turn-recorder'

export type HomeChatTurnEngineDeps = {
  thread: (chatId: string) => HomeChatThread | undefined
  approvals: HomeChatApprovals
  machines: HomeChatMachineProvider
  runOrcaCli: HomeChatToolContext['runOrcaCli']
  services: HomeChatAssistantServices
  driverFor: (thread: HomeChatThread) => Promise<HomeChatDriver>
  systemPrompt: (thread: HomeChatThread) => Promise<string>
  onTurnEnded: (chatId: string, failed: boolean) => void
  publishEntry: (chatId: string, entry: HomeChatEntry) => void
  publishSummary: (thread: HomeChatThread) => void
}

type TurnInput =
  | { origin: 'user'; text: string }
  | { origin: 'notice'; source: HomeChatNoticeSource; text: string }

const TITLE_LENGTH = 60

/**
 * Runs each thread's turns, one at a time. The engine owns everything around the model: recording,
 * tools, compaction, stopping and the single way a turn ends. A driver only talks to its model.
 */
export class HomeChatTurnEngine {
  private readonly running = new Map<string, AbortController>()
  private readonly pendingWakes = new Map<string, Extract<TurnInput, { origin: 'notice' }>[]>()

  constructor(private readonly deps: HomeChatTurnEngineDeps) {}

  isRunning(chatId: string): boolean {
    return this.running.has(chatId)
  }

  /** Starts the turn and returns once it is accepted; the answer streams as entries. */
  send(chatId: string, text: string): void {
    const thread = this.deps.thread(chatId)
    if (!thread) {
      throw new Error('This chat no longer exists')
    }
    if (this.running.has(chatId)) {
      throw new Error('Wait for the current answer or stop it first')
    }
    if (!thread.items.some((item) => item.type === 'user' && item.origin === 'user')) {
      thread.updateMeta({ title: text.trim().replace(/\s+/g, ' ').slice(0, TITLE_LENGTH) })
    }
    this.start(thread, { origin: 'user', text })
  }

  /** Something finished in the background: the assistant reacts now, or right after the current turn. */
  wake(chatId: string, source: HomeChatNoticeSource, text: string): void {
    const thread = this.deps.thread(chatId)
    if (!thread) {
      return
    }
    const input: TurnInput = { origin: 'notice', source, text }
    if (this.running.has(chatId)) {
      this.pendingWakes.set(chatId, [...(this.pendingWakes.get(chatId) ?? []), input])
      return
    }
    this.start(thread, input)
  }

  /** Show the user something without involving the model. */
  note(chatId: string, event: HomeChatThreadEvent): void {
    const thread = this.deps.thread(chatId)
    if (thread) {
      this.recorderFor(thread).event(event)
    }
  }

  stop(chatId: string): void {
    this.pendingWakes.delete(chatId)
    this.running.get(chatId)?.abort()
    this.deps.approvals.declineAll(chatId)
  }

  stopAll(): void {
    for (const chatId of this.running.keys()) {
      this.stop(chatId)
    }
  }

  /** Summarize the older part of the thread now, at the user's request. */
  async compactNow(chatId: string): Promise<boolean> {
    const thread = this.deps.thread(chatId)
    if (!thread) {
      throw new Error('This chat no longer exists')
    }
    if (this.running.has(chatId)) {
      throw new Error('Wait for the current answer or stop it first')
    }
    const controller = new AbortController()
    this.running.set(chatId, controller)
    this.setStatus(thread, 'running')
    try {
      const driver = await this.deps.driverFor(thread)
      const systemPrompt = await this.deps.systemPrompt(thread)
      const compacted = await compactHomeChatThread({
        thread,
        driver,
        systemPrompt,
        recorder: this.recorderFor(thread),
        signal: controller.signal,
        force: true,
        auto: false
      })
      this.measure(thread, driver, systemPrompt)
      return compacted
    } finally {
      this.running.delete(chatId)
      this.setStatus(thread, 'idle')
      await thread.flush()
    }
  }

  private recorderFor(thread: HomeChatThread): HomeChatTurnRecorder {
    return new HomeChatTurnRecorder(thread, (entry) => this.deps.publishEntry(thread.id, entry))
  }

  private setStatus(thread: HomeChatThread, status: HomeChatThread['status']): void {
    thread.status = status
    this.deps.publishSummary(thread)
  }

  private measure(thread: HomeChatThread, driver: HomeChatDriver, systemPrompt: string): void {
    thread.updateMeta({
      contextUsed: driver.contextTokens(thread, systemPrompt),
      contextWindow: driver.contextWindow
    })
  }

  private start(thread: HomeChatThread, input: TurnInput): void {
    const controller = new AbortController()
    this.running.set(thread.id, controller)
    this.setStatus(thread, 'running')
    void this.runTurn(thread, input, controller)
  }

  private startNextWake(thread: HomeChatThread): void {
    const queue = this.pendingWakes.get(thread.id) ?? []
    this.pendingWakes.delete(thread.id)
    if (queue.length === 0 || !this.deps.thread(thread.id)) {
      return
    }
    this.start(thread, {
      origin: 'notice',
      source: queue.length === 1 ? queue[0].source : 'job',
      text: queue.map((item) => item.text).join('\n\n')
    })
  }

  private async runTurn(
    thread: HomeChatThread,
    input: TurnInput,
    controller: AbortController
  ): Promise<void> {
    const { signal } = controller
    const recorder = this.recorderFor(thread)
    // The message is in the log before anything can fail, so it is never lost.
    const item = recorder.userMessage(
      input.text,
      input.origin,
      input.origin === 'notice' ? input.source : undefined
    )
    let failed = false
    let sessionId: string | null = null
    let measured: { driver: HomeChatDriver; systemPrompt: string } | null = null
    try {
      if (item.type !== 'user') {
        throw new Error('The message could not be recorded')
      }
      const driver = await this.deps.driverFor(thread)
      const systemPrompt = await this.deps.systemPrompt(thread)
      measured = { driver, systemPrompt }
      const guard = new RepeatGuard()
      const compaction = { thread, driver, systemPrompt, recorder, signal, auto: true }
      // A divider never parts a turn's own steps: it sits above the message that started the turn.
      let dividers = 0
      const compact = async (force = false): Promise<void> => {
        const ord = item.ord - 0.5 + dividers * 0.01
        if (await compactHomeChatThread({ ...compaction, force, ord })) {
          dividers++
        }
      }
      await compact()
      await driver.runTurn({
        thread,
        input: item,
        systemPrompt,
        recorder,
        signal,
        compact,
        confirmSession: (id) => {
          sessionId = id
        },
        runTool: (call) =>
          runHomeChatToolCall(call, {
            chatId: thread.id,
            recorder,
            approvals: this.deps.approvals,
            guard,
            machines: this.deps.machines,
            runOrcaCli: this.deps.runOrcaCli,
            services: this.deps.services,
            signal,
            onMachine: (label) => {
              if (thread.meta.lastMachine !== label) {
                thread.updateMeta({ lastMachine: label })
                this.deps.publishSummary(thread)
              }
            }
          })
      })
      // The single way a turn ends: stopped, failed and finished all pass through finish().
      recorder.finish(signal.aborted ? 'interrupted' : 'end')
      if (signal.aborted) {
        recorder.event({ kind: 'progress', text: 'Stopped.' })
      }
    } catch (error) {
      recorder.finish('interrupted')
      if (signal.aborted) {
        recorder.event({ kind: 'progress', text: 'Stopped.' })
      } else {
        failed = true
        recorder.event({
          kind: 'error',
          text: error instanceof Error ? error.message : String(error)
        })
      }
    } finally {
      this.settleSession(thread, sessionId)
      if (measured && !signal.aborted && !failed) {
        // Compact after the answer so the next message starts with room to work.
        await compactHomeChatThread({
          ...measured,
          thread,
          recorder,
          signal,
          force: false,
          auto: true
        }).catch((error: unknown) => console.warn('[home-chat] compaction failed', error))
      }
      if (measured) {
        this.measure(thread, measured.driver, measured.systemPrompt)
      }
      this.running.delete(thread.id)
      this.deps.approvals.declineAll(thread.id)
      this.setStatus(thread, failed ? 'error' : 'idle')
      this.deps.onTurnEnded(thread.id, failed || signal.aborted)
      await thread.flush()
      if (!signal.aborted) {
        this.startNextWake(thread)
      }
    }
  }

  /** Remember the CLI session that now holds this thread, up to everything recorded so far. */
  private settleSession(thread: HomeChatThread, sessionId: string | null): void {
    const { backend, accountId } = thread.meta
    if (sessionId && backend !== 'openai-compatible') {
      thread.updateMeta({
        providerSession: { backend, accountId, sessionId, throughSeq: thread.lastSeq }
      })
    }
  }
}
