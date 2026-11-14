import type { LiveMessage, LiveSendRequest } from '../../../shared/live-sessions/live-session-types'
import type { RouteAttempt } from './session-input-routes'
import type { UserText } from './transcript-user-texts'
import { confirmSent, sentBySession } from './live-message-confirmation'
import { LiveSessionJsonStore } from '../live-session-json-store'
import {
  DEFAULT_OUTBOX_TIMING,
  publicView,
  type LiveMessageOutboxDeps,
  isOutboxItem,
  type OutboxItem as Item
} from './live-message-outbox-types'

/**
 * Follows every message from the moment Seal has it until the session's transcript holds it as
 * the user's message (ported from SISomewhere's outbox):
 *
 *  - One message at a time per session, in send order. The next waits until the one ahead is in
 *    the transcript: Claude Code queues what's typed while it works, and a message typed just as
 *    a turn ends can jump that queue.
 *  - The same messageId is never sent twice: a resend after a dropped connection reports where
 *    the first stands.
 *  - Kept on disk, so a restart neither loses a message nor types it again: one that was being
 *    typed when Seal stopped counts as sent and waits for the transcript.
 */

export class LiveMessageOutbox {
  private readonly items = new Map<string, Item>()
  private readonly running = new Set<string>()
  /** Messages a worker holds, from picking one until it is typed or given up: no second worker takes them. */
  private readonly claimed = new Set<string>()
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly timing: typeof DEFAULT_OUTBOX_TIMING
  private confirmTimer: ReturnType<typeof setTimeout> | null = null
  private confirming = false
  private readonly store: LiveSessionJsonStore<Item>
  private started: Promise<void> | null = null
  private readonly abort = new AbortController()

  constructor(private readonly deps: LiveMessageOutboxDeps) {
    this.now = deps.now ?? Date.now
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    this.timing = { ...DEFAULT_OUTBOX_TIMING, ...deps.timing }
    this.store = new LiveSessionJsonStore(deps.storePath, isOutboxItem, deps.log)
  }

  start(): Promise<void> {
    this.started ??= this.store.load().then((loaded) => {
      for (const item of loaded) {
        this.items.set(item.messageId, item)
      }
      for (const item of this.items.values()) {
        if (item.state === 'sending') {
          // It may already be at the prompt: only the transcript can say, never a second send.
          item.state = 'sent'
          item.sentAt ??= this.now()
        }
      }
      for (const sessionId of new Set([...this.items.values()].map((i) => i.sessionId))) {
        this.kick(sessionId)
      }
      this.scheduleConfirm()
    })
    return this.started
  }

  stop(): void {
    this.abort.abort()
    if (this.confirmTimer) {
      clearTimeout(this.confirmTimer)
    }
    this.confirmTimer = null
  }

  /** Look again while anything typed is still unconfirmed; settle once nothing is. */
  private scheduleConfirm(): void {
    if (this.confirmTimer || this.abort.signal.aborted) {
      return
    }
    if (![...this.items.values()].some((i) => i.state === 'sent')) {
      return
    }
    this.confirmTimer = setTimeout(() => {
      this.confirmTimer = null
      void this.confirm()
    }, this.timing.confirmEveryMs)
    this.confirmTimer.unref?.()
  }

  list(sessionId?: string): LiveMessage[] {
    return [...this.items.values()]
      .filter((i) => !sessionId || i.sessionId === sessionId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(publicView)
  }

  async send(request: LiveSendRequest): Promise<LiveMessage> {
    await this.start()
    const existing = this.items.get(request.messageId)
    if (existing) {
      return publicView(existing)
    }
    const now = this.now()
    const item: Item = {
      messageId: request.messageId,
      sessionId: request.sessionId,
      text: request.text,
      state: 'queued',
      route: null,
      error: null,
      createdAt: now,
      updatedAt: now,
      offset: 0,
      sentAt: null
    }
    this.items.set(item.messageId, item)
    this.changed(item)
    this.kick(item.sessionId)
    return publicView(item)
  }

  /** Put a failed message back in line under the same id. */
  async retry(messageId: string): Promise<LiveMessage | null> {
    await this.start()
    const item = this.items.get(messageId)
    if (!item || item.state !== 'failed') {
      return item ? publicView(item) : null
    }
    this.set(item, { state: 'queued', error: null, route: null, sentAt: null })
    this.kick(item.sessionId)
    return publicView(item)
  }

  /** The session now goes by another id; its messages follow it, in order. */
  renameSession(from: string, to: string): void {
    for (const item of this.items.values()) {
      if (item.sessionId === from) {
        this.set(item, { sessionId: to })
      }
    }
    if (this.next(to)) {
      this.kick(to)
    }
  }

  private kick(sessionId: string): void {
    if (this.running.has(sessionId)) {
      return
    }
    this.running.add(sessionId)
    void this.work(sessionId).finally(() => {
      this.running.delete(sessionId)
      if (this.next(sessionId) && !this.abort.signal.aborted) {
        this.kick(sessionId)
      }
    })
  }

  private next(sessionId: string): Item | null {
    let best: Item | null = null
    for (const item of this.items.values()) {
      if (
        item.sessionId === sessionId &&
        item.state === 'queued' &&
        !this.claimed.has(item.messageId) &&
        (!best || item.createdAt < best.createdAt)
      ) {
        best = item
      }
    }
    return best
  }

  private aheadInFlight(item: Item): boolean {
    const now = this.now()
    for (const other of this.items.values()) {
      if (
        other !== item &&
        other.sessionId === item.sessionId &&
        other.createdAt <= item.createdAt &&
        (this.claimed.has(other.messageId) ||
          (other.state === 'sent' && now - (other.sentAt ?? now) < this.timing.orderHoldMs))
      ) {
        return true
      }
    }
    return false
  }

  private async work(sessionId: string): Promise<void> {
    for (;;) {
      const item = this.next(sessionId)
      if (!item || this.abort.signal.aborted) {
        return
      }
      this.claimed.add(item.messageId)
      try {
        while (this.aheadInFlight(item) && !this.abort.signal.aborted) {
          await this.sleep(200)
        }
        await this.deliver(item)
      } finally {
        this.claimed.delete(item.messageId)
      }
    }
  }

  private async deliver(item: Item): Promise<void> {
    const queuedAt = this.now()
    for (;;) {
      const session = this.deps.getSession(item.sessionId)
      if (!session) {
        this.set(item, {
          state: 'failed',
          error: 'The session is no longer running on any connected machine'
        })
        return
      }
      if (session.inputRoutes.length === 0) {
        this.set(item, {
          state: 'failed',
          error:
            'Seal cannot type into this session: it is not in a Seal pane or tmux, and it is still running'
        })
        return
      }
      let busy = false
      const reasons: string[] = []
      for (const route of session.inputRoutes) {
        const offset = await this.deps.transcriptSize(session).catch(() => 0)
        this.set(item, { state: 'sending', route: route.kind, offset, sentAt: this.now() })
        let result: RouteAttempt
        try {
          result = await this.deps.attempt(
            session,
            route,
            item.text,
            item.messageId,
            this.abort.signal
          )
        } catch (error) {
          // Whether bytes landed is unknown; only the transcript may confirm it from here.
          this.deps.log?.(`[live-sessions] delivering ${item.messageId} threw`, error)
          result = { outcome: 'sent' }
        }
        if (result.outcome === 'sent') {
          this.set(item, { state: 'sent' })
          void this.confirm()
          return
        }
        if (result.outcome === 'failed') {
          this.set(item, { state: 'failed', error: result.error })
          return
        }
        if (result.outcome === 'busy') {
          busy = true
          break
        }
        reasons.push(result.reason)
      }
      if (!busy) {
        this.set(item, {
          state: 'failed',
          error: reasons.join('; ') || 'No way to reach the session'
        })
        return
      }
      if (this.now() - queuedAt > this.timing.busyTimeoutMs) {
        this.set(item, {
          state: 'failed',
          error: 'The session prompt stayed busy (a draft or a dialog)'
        })
        return
      }
      this.set(item, { state: 'queued', route: null })
      await this.sleep(this.timing.busyRetryMs)
      if (this.abort.signal.aborted) {
        return
      }
    }
  }

  /** Find sent messages in their transcripts; fail those whose session closed without reading them. */
  async confirm(): Promise<void> {
    if (this.confirming) {
      return
    }
    this.confirming = true
    try {
      for (const [sessionId, items] of sentBySession(this.items.values())) {
        const session = this.deps.getSession(sessionId)
        let records: UserText[] = []
        if (session?.transcriptPath) {
          const from = Math.min(...items.map((i) => i.offset))
          records = await this.deps.userTexts(session, from).catch(() => [])
        }
        for (const { item, patch } of confirmSent(
          items,
          records,
          session,
          this.now(),
          this.timing
        )) {
          this.set(item, patch)
        }
      }
    } finally {
      this.confirming = false
      this.scheduleConfirm()
    }
  }

  private set(item: Item, patch: Partial<Item>): void {
    Object.assign(item, patch, { updatedAt: this.now() })
    this.changed(item)
  }

  private changed(item: Item): void {
    this.deps.onChange(publicView(item))
    this.persist()
  }

  private persist(): void {
    const cut = this.now() - this.timing.keepFinishedMs
    for (const [id, item] of this.items) {
      if ((item.state === 'delivered' || item.state === 'failed') && item.updatedAt < cut) {
        this.items.delete(id)
      }
    }
    this.store.save([...this.items.values()])
  }

  /** Resolves once everything changed so far is on disk. */
  flush(): Promise<void> {
    return this.store.flush()
  }
}
