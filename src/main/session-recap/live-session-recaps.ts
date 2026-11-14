import type {
  LiveSession,
  LiveSessionRegistryEvent,
  LiveSessionStatus
} from '../../shared/live-sessions/live-session-types'
import {
  openRecapItems,
  type LiveSessionRecapBrief,
  type RecapItemMark,
  type SessionRecapState,
  type SessionRecapView
} from '../../shared/session-recap/session-recap-types'
import type { RecapPassOutcome, SessionRecapEngine } from './session-recap-engine'
import type { SessionRecapStore } from './session-recap-store'

export type LiveSessionRecapsDeps = {
  engine: Pick<SessionRecapEngine, 'update' | 'isUpdating' | 'failure' | 'forget'>
  store: SessionRecapStore
  /** Recaps are on and this host has a utility model. */
  enabled: () => boolean
  /** Utility requests are held until then after a rate limit; null when they run. */
  pausedUntil: () => number | null
  /** The session as the registry holds it, by any id it has gone by. */
  session: (sessionId: string) => LiveSession | null
  /**
   * Whether every stopped session gets a recap, or only those someone opened here. A headless
   * server leaves the rest to the desktop that also sees them.
   */
  eager: boolean
  setTimer?: (run: () => void, delayMs: number) => { cancel: () => void }
  now?: () => number
}

/** The moments a recap is brought up to date on its own: a turn has ended, or parked. */
const SETTLED: ReadonlySet<LiveSessionStatus> = new Set([
  'waiting-input',
  'idle',
  'waiting-subagent',
  'waiting-task'
])
const SETTLE_DELAY_MS = 2_500
/** One automatic pass per session in this long; a stop inside it is picked up when it ends. */
export const RECAP_AUTO_INTERVAL_MS = 4 * 60_000
/** Opening a session again this soon does not start another pass. */
const OPEN_INTERVAL_MS = 60_000

type Tracked = {
  /** The stop last handled, so a rescan of the same stop schedules nothing. */
  stamp: string | null
  timer: { cancel: () => void } | null
  lastPassAt: number
  outcome: RecapPassOutcome | null
}

function defaultTimer(run: () => void, delayMs: number): { cancel: () => void } {
  const timer = setTimeout(run, delayMs)
  timer.unref?.()
  return { cancel: () => clearTimeout(timer) }
}

/** Recaps for the registry's sessions: when each is brought up to date, and what clients read. */
export class LiveSessionRecaps {
  private readonly tracked = new Map<string, Tracked>()
  private readonly setTimer: NonNullable<LiveSessionRecapsDeps['setTimer']>

  constructor(private readonly deps: LiveSessionRecapsDeps) {
    this.setTimer = deps.setTimer ?? defaultTimer
  }

  observe(event: LiveSessionRegistryEvent): void {
    if (event.type === 'remove') {
      this.tracked.get(event.sessionId)?.timer?.cancel()
      this.tracked.delete(event.sessionId)
      this.deps.engine.forget(event.sessionId)
      if (event.replacedBy) {
        this.deps.store.move(event.sessionId, event.replacedBy)
      }
      return
    }
    if (event.type !== 'upsert') {
      return
    }
    const { session } = event
    if (!session.alive || !session.transcriptPath || !SETTLED.has(session.status)) {
      const tracked = this.tracked.get(session.id)
      if (tracked) {
        tracked.stamp = null
      }
      return
    }
    const tracked = this.track(session.id)
    const stamp = `${session.status}:${session.lastActivityAt}`
    if (tracked.stamp === stamp) {
      return
    }
    tracked.stamp = stamp
    this.schedule(session.id, tracked)
  }

  /** The utility model came back: sessions that stopped while it was away are due again. */
  resume(): void {
    for (const [sessionId, tracked] of this.tracked) {
      if (tracked.stamp !== null && !tracked.timer) {
        this.schedule(sessionId, tracked)
      }
    }
  }

  /** The session as clients see it: its recap title and what is still open for the user. */
  decorate(session: LiveSession): LiveSession {
    if (!this.deps.enabled()) {
      return session
    }
    const stored = this.deps.store.get(session.id)
    const updating = this.deps.engine.isUpdating(session.id)
    if (!stored?.recap && !updating) {
      return session
    }
    const recap = stored?.recap
    const marks = stored?.marks ?? {}
    const brief: LiveSessionRecapBrief = {
      title: recap?.title ?? null,
      rev: stored?.rev ?? 0,
      questions: recap ? openRecapItems(recap.questions, marks).length : 0,
      actions: recap ? openRecapItems(recap.actions, marks).length : 0
    }
    if (updating) {
      brief.updating = true
    }
    return { ...session, recap: brief }
  }

  /** What a client draws. `look` is the user opening it: a visit, and a pass when it is out of date. */
  view(sessionId: string, look: boolean): SessionRecapView {
    const session = this.deps.session(sessionId)
    const id = session?.id ?? sessionId
    const now = this.now()
    const since =
      look && this.deps.enabled()
        ? this.deps.store.look(id, now)
        : (this.deps.store.get(id)?.previousLookedAt ?? null)
    const stored = this.deps.store.get(id)
    const recap = stored?.recap ?? null
    const stale = session !== null && recap !== null && session.lastActivityAt > recap.updatedAt
    const tracked = this.track(id)
    if (
      look &&
      (stale || recap === null) &&
      session?.transcriptPath &&
      this.available() &&
      now - tracked.lastPassAt > OPEN_INTERVAL_MS
    ) {
      this.run(id, tracked, 'asked', false)
    }
    return {
      sessionId: id,
      recap,
      marks: stored?.marks ?? {},
      since,
      state: this.state(id, tracked, recap !== null, stale),
      stale,
      pausedUntil: this.deps.pausedUntil(),
      failure: this.deps.engine.failure(id),
      rev: stored?.rev ?? 0
    }
  }

  /** A pass now; with nothing new to read, the recap is rebuilt from the recent history. */
  async refresh(sessionId: string): Promise<SessionRecapView> {
    const session = this.deps.session(sessionId)
    const id = session?.id ?? sessionId
    if (this.deps.enabled() && session?.transcriptPath) {
      const tracked = this.track(id)
      if ((await this.run(id, tracked, 'asked', false)) === 'current') {
        await this.run(id, tracked, 'asked', true)
      }
    }
    return this.view(id, false)
  }

  mark(sessionId: string, itemId: string, mark: RecapItemMark | null): SessionRecapView {
    const id = this.deps.session(sessionId)?.id ?? sessionId
    this.deps.store.mark(id, itemId, mark)
    return this.view(id, false)
  }

  dispose(): void {
    for (const tracked of this.tracked.values()) {
      tracked.timer?.cancel()
    }
    this.tracked.clear()
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  private available(): boolean {
    return this.deps.enabled() && this.deps.pausedUntil() === null
  }

  private track(sessionId: string): Tracked {
    let tracked = this.tracked.get(sessionId)
    if (!tracked) {
      tracked = { stamp: null, timer: null, lastPassAt: 0, outcome: null }
      this.tracked.set(sessionId, tracked)
    }
    return tracked
  }

  private schedule(sessionId: string, tracked: Tracked): void {
    if (!this.deps.eager && !this.deps.store.get(sessionId)?.recap) {
      return
    }
    tracked.timer?.cancel()
    const wait = Math.max(SETTLE_DELAY_MS, tracked.lastPassAt + RECAP_AUTO_INTERVAL_MS - this.now())
    tracked.timer = this.setTimer(() => {
      tracked.timer = null
      // Still the stop it was scheduled for; a session back at work is recapped when it next stops.
      if (this.tracked.get(sessionId) === tracked && tracked.stamp !== null && this.available()) {
        void this.run(sessionId, tracked, 'auto', false)
      }
    }, wait)
  }

  private run(
    sessionId: string,
    tracked: Tracked,
    kind: 'auto' | 'asked',
    rebuild: boolean
  ): Promise<RecapPassOutcome> {
    tracked.lastPassAt = this.now()
    return this.deps.engine.update(sessionId, kind, rebuild).then((outcome) => {
      tracked.outcome = outcome
      return outcome
    })
  }

  private state(
    sessionId: string,
    tracked: Tracked,
    hasRecap: boolean,
    stale: boolean
  ): SessionRecapState {
    if (!this.deps.enabled()) {
      return 'unavailable'
    }
    if (this.deps.engine.isUpdating(sessionId)) {
      return 'updating'
    }
    // A recap that covers everything is ready whatever stopped the pass after it.
    if (hasRecap && !stale) {
      return 'ready'
    }
    if (this.deps.pausedUntil() !== null) {
      return 'paused'
    }
    if (tracked.outcome === 'failed' && this.deps.engine.failure(sessionId)) {
      return 'failed'
    }
    if (tracked.outcome === 'over-budget') {
      return 'over-budget'
    }
    return hasRecap ? 'ready' : 'empty'
  }
}
