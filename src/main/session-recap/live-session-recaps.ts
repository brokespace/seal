import {
  isSettledLiveSessionStatus,
  isTurnRunningLiveSessionStatus
} from '../../shared/live-sessions/live-session-status'
import type {
  LiveSession,
  LiveSessionRegistryEvent
} from '../../shared/live-sessions/live-session-types'
import { recapTurnHasEnded } from '../../shared/session-recap/session-recap-request-display'
import type {
  RecapItemMark,
  SessionRecapView
} from '../../shared/session-recap/session-recap-types'
import { unrefTimer } from '../session-summaries/unref-timer'
import type { ServerSessionRecapsSource } from './server-session-recaps-source'
import type { RecapPassOutcome, SessionRecapEngine } from './session-recap-engine'
import { recapBrief, recapViewState, shownRecap } from './session-recap-shown'
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
  /** The session's conversation can be read here: a transcript file, or a chat's journal. */
  readable: (session: LiveSession) => boolean
  /** Paired servers' own recaps. Absent on a host that reaches no server, and on a server itself. */
  server?: ServerSessionRecapsSource
  setTimer?: (run: () => void, delayMs: number) => { cancel: () => void }
  now?: () => number
}

const SETTLE_DELAY_MS = 2_500
/** One automatic pass per session in this long; a stop inside it is picked up when it ends. */
export const RECAP_AUTO_INTERVAL_MS = 4 * 60_000
/** Opening a session again this soon does not start another pass. */
const OPEN_INTERVAL_MS = 60_000
/** A session at work is recapped once it has said this much since its last pass... */
export const RECAP_WORKING_MIN_PROSE_CHARS = 1_200
/** ...or, having said anything at all, once this long has gone by. */
export const RECAP_WORKING_MAX_WAIT_MS = 10 * 60_000
/** How often a working session's transcript is read to see whether it has said enough. */
const WORKING_CHECK_MS = 60_000

type Tracked = {
  /** The stop last handled, so a rescan of the same stop schedules nothing. */
  stamp: string | null
  /** When it was first seen at work on this turn; null while it is not working. */
  workingSince: number | null
  timer: { cancel: () => void } | null
  /** The last pass for a stop or for the user; a pass made mid-turn never delays those. */
  lastPassAt: number
  lastWorkingPassAt: number
  outcome: RecapPassOutcome | null
}

/** Recaps for the registry's sessions: when each is brought up to date, and what clients read. */
export class LiveSessionRecaps {
  private readonly tracked = new Map<string, Tracked>()
  private readonly setTimer: NonNullable<LiveSessionRecapsDeps['setTimer']>

  constructor(private readonly deps: LiveSessionRecapsDeps) {
    this.setTimer = deps.setTimer ?? unrefTimer
  }

  observe(event: LiveSessionRegistryEvent): void {
    if (event.type === 'remove') {
      this.tracked.get(event.sessionId)?.timer?.cancel()
      this.tracked.delete(event.sessionId)
      this.deps.engine.forget(event.sessionId)
      this.deps.server?.forget(event.sessionId)
      if (event.replacedBy) {
        this.deps.store.move(event.sessionId, event.replacedBy)
      }
      return
    }
    if (event.type !== 'upsert') {
      return
    }
    const { session } = event
    if (this.deps.server?.owns(session)) {
      // One recap per session: the server that runs it makes it, and this host only shows it.
      this.deps.server.observe(session)
      this.tracked.get(session.id)?.timer?.cancel()
      this.tracked.delete(session.id)
      return
    }
    const readable = session.alive && this.deps.readable(session)
    if (readable && isTurnRunningLiveSessionStatus(session.status)) {
      const tracked = this.track(session.id)
      tracked.stamp = null
      tracked.workingSince ??= this.now()
      this.scheduleWorking(session.id, tracked)
      return
    }
    if (!readable || !isSettledLiveSessionStatus(session.status)) {
      const tracked = this.tracked.get(session.id)
      if (tracked) {
        tracked.stamp = null
        tracked.workingSince = null
      }
      return
    }
    const tracked = this.track(session.id)
    tracked.workingSince = null
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
    if (this.deps.server?.owns(session)) {
      const brief = this.deps.server.brief(session)
      return brief ? { ...session, recap: brief } : session
    }
    if (!this.deps.enabled()) {
      return session
    }
    const stored = this.deps.store.get(session.id)
    const updating = this.deps.engine.isUpdating(session.id)
    const recap = stored?.recap ?? null
    const shown =
      recap &&
      shownRecap(recap, {
        turnEnded: recapTurnHasEnded(session.status),
        stale: session.lastActivityAt > recap.updatedAt
      })
    const brief = recapBrief(shown, stored?.marks ?? {}, stored?.rev ?? 0, updating)
    return brief ? { ...session, recap: brief } : session
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
      session &&
      this.deps.readable(session) &&
      this.available() &&
      now - Math.max(tracked.lastPassAt, tracked.lastWorkingPassAt) > OPEN_INTERVAL_MS
    ) {
      this.run(id, tracked, 'asked', false)
    }
    const turnEnded = session !== null && recapTurnHasEnded(session.status)
    return {
      sessionId: id,
      recap: recap && shownRecap(recap, { turnEnded, stale }),
      marks: stored?.marks ?? {},
      since,
      state: recapViewState({
        enabled: this.deps.enabled(),
        updating: this.deps.engine.isUpdating(id),
        hasRecap: recap !== null,
        stale,
        paused: this.deps.pausedUntil() !== null,
        failed: tracked.outcome === 'failed' && Boolean(this.deps.engine.failure(id)),
        overBudget: tracked.outcome === 'over-budget'
      }),
      stale,
      pausedUntil: this.deps.pausedUntil(),
      failure: this.deps.engine.failure(id),
      rev: stored?.rev ?? 0,
      turnEnded
    }
  }

  /** `view` for any session: one a paired server keeps is read from that server. */
  async get(sessionId: string, look: boolean): Promise<SessionRecapView> {
    const owned = this.serverOwned(sessionId)
    return owned ? owned.server.view(owned.session, look) : this.view(sessionId, look)
  }

  /** A pass now; with nothing new to read, the recap is rebuilt from the recent history. */
  async refresh(sessionId: string): Promise<SessionRecapView> {
    const session = this.deps.session(sessionId)
    const owned = this.serverOwned(sessionId)
    if (owned) {
      return owned.server.refresh(owned.session)
    }
    const id = session?.id ?? sessionId
    if (this.deps.enabled() && session && this.deps.readable(session)) {
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

  /** `mark` for any session: one a paired server keeps is marked on that server. */
  async setMark(
    sessionId: string,
    itemId: string,
    mark: RecapItemMark | null
  ): Promise<SessionRecapView> {
    const owned = this.serverOwned(sessionId)
    return owned
      ? owned.server.mark(owned.session, itemId, mark)
      : this.mark(sessionId, itemId, mark)
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

  private serverOwned(
    sessionId: string
  ): { server: ServerSessionRecapsSource; session: LiveSession } | null {
    const { server } = this.deps
    const session = this.deps.session(sessionId)
    return server && session && server.owns(session) ? { server, session } : null
  }

  private available(): boolean {
    return this.deps.enabled() && this.deps.pausedUntil() === null
  }

  private track(sessionId: string): Tracked {
    let tracked = this.tracked.get(sessionId)
    if (!tracked) {
      tracked = {
        stamp: null,
        workingSince: null,
        timer: null,
        lastPassAt: 0,
        lastWorkingPassAt: 0,
        outcome: null
      }
      this.tracked.set(sessionId, tracked)
    }
    return tracked
  }

  private schedule(sessionId: string, tracked: Tracked): void {
    tracked.timer?.cancel()
    const wait = Math.max(SETTLE_DELAY_MS, tracked.lastPassAt + RECAP_AUTO_INTERVAL_MS - this.now())
    tracked.timer = this.setTimer(() => {
      tracked.timer = null
      // Still the stop it was scheduled for; a session back at work is recapped as it works.
      if (this.tracked.get(sessionId) === tracked && tracked.stamp !== null && this.available()) {
        void this.run(sessionId, tracked, 'auto', false)
      }
    }, wait)
  }

  /** A working turn's passes count from its start, or from the last pass of any kind since. */
  private workingBase(tracked: Tracked): number {
    return Math.max(tracked.workingSince ?? 0, tracked.lastPassAt, tracked.lastWorkingPassAt)
  }

  /** While a session works: a look at what it has said since its recap, once a pass may follow. */
  private scheduleWorking(sessionId: string, tracked: Tracked): void {
    if (tracked.timer) {
      return
    }
    const wait = Math.max(
      WORKING_CHECK_MS,
      this.workingBase(tracked) + RECAP_AUTO_INTERVAL_MS - this.now()
    )
    tracked.timer = this.setTimer(() => {
      tracked.timer = null
      if (
        this.tracked.get(sessionId) === tracked &&
        tracked.workingSince !== null &&
        this.available()
      ) {
        void this.runWorking(sessionId, tracked)
      }
    }, wait)
  }

  private async runWorking(sessionId: string, tracked: Tracked): Promise<void> {
    const overdue = this.now() - this.workingBase(tracked) >= RECAP_WORKING_MAX_WAIT_MS
    const outcome = await this.deps.engine.update(
      sessionId,
      'working',
      false,
      overdue ? 1 : RECAP_WORKING_MIN_PROSE_CHARS
    )
    // Too little said yet: the next activity looks again. Anything else waits out the interval.
    if (outcome !== 'current') {
      tracked.lastWorkingPassAt = this.now()
    }
    // Out of the working tier is not out of budget for the user, who can still open or refresh.
    if (outcome === 'updated' || outcome === 'failed') {
      tracked.outcome = outcome
    }
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
}
