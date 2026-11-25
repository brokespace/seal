import { isWaitingOnBackgroundWork } from '../../shared/live-sessions/live-session-status'
import type { LiveSession } from '../../shared/live-sessions/live-session-types'
import { unrefTimer } from '../session-summaries/unref-timer'
import type { RecapPassOutcome, SessionRecapEngine } from './session-recap-engine'

export type RecapPassScheduleDeps = {
  engine: Pick<SessionRecapEngine, 'update'>
  /** Recaps are on and this host has a utility model. */
  enabled: () => boolean
  /** Utility requests are held until then after a rate limit; null when they run. */
  pausedUntil: () => number | null
  /** The session as the registry holds it, by any id it has gone by. */
  session: (sessionId: string) => LiveSession | null
  /**
   * The least time between two passes at a turn's end on the provider in use; absent, only
   * `RECAP_TURN_END_SHARE_MS`. A provider that starts a process per request sets one.
   */
  turnEndIntervalMs?: () => number
  setTimer?: (run: () => void, delayMs: number) => { cancel: () => void }
  now?: () => number
}

const SETTLE_DELAY_MS = 2_500
/** Turns that end this close together share one pass. */
export const RECAP_TURN_END_SHARE_MS = 20_000
/** One pass in this long while a turn runs; a turn's end never waits for it. */
export const RECAP_AUTO_INTERVAL_MS = 4 * 60_000
/** Opening a session whose turn still runs starts a pass at most this often: it is always behind. */
const OPEN_INTERVAL_MS = 60_000
/** A session at work is recapped once it has said this much since its last pass... */
export const RECAP_WORKING_MIN_PROSE_CHARS = 1_200
/** ...or, having said anything at all, once this long has gone by. */
export const RECAP_WORKING_MAX_WAIT_MS = 10 * 60_000
/** How often a working session's transcript is read to see whether it has said enough. */
const WORKING_CHECK_MS = 60_000
/** A pass that failed is tried again this long after each failure, then left to the next turn end. */
export const RECAP_RETRY_DELAYS_MS = [30_000, 2 * 60_000, 10 * 60_000]
/** Past a pause's end, so the provider has lifted it when the pass asks. */
const PAUSE_END_MARGIN_MS = 1_000

type TimerPurpose = 'rest' | 'working' | 'parked'

type Tracked = {
  /** The rest last handled, so a rescan of the same rest schedules nothing. */
  stamp: string | null
  /** When it was first seen at work on this turn; null while it is not working. */
  workingSince: number | null
  /**
   * One timer at a time: `rest` waits for a pass at a turn's end, `working` for one inside a turn,
   * `parked` for one inside a turn that stopped writing.
   */
  timer: { cancel: () => void; for: TimerPurpose } | null
  /** The last pass for a turn's end or for the user; a pass made mid-turn never delays those. */
  lastPassAt: number
  lastWorkingPassAt: number
  outcome: RecapPassOutcome | null
  /** The session's last activity when the last pass that read its transcript to the end began. */
  readThrough: number
  /** Failed passes since one last worked: how far along the retry delays the session is. */
  failures: number
  /** A turn ended and no pass has covered it yet. */
  due: boolean
}

/** When each session's recap is brought up to date: at a turn's end, inside a long turn, after a failure. */
export class RecapPassSchedule {
  private readonly tracked = new Map<string, Tracked>()
  private readonly setTimer: NonNullable<RecapPassScheduleDeps['setTimer']>

  constructor(private readonly deps: RecapPassScheduleDeps) {
    this.setTimer = deps.setTimer ?? unrefTimer
  }

  /** The session is gone, or another host makes its recap. */
  forget(sessionId: string): void {
    this.tracked.get(sessionId)?.timer?.cancel()
    this.tracked.delete(sessionId)
  }

  /** Its conversation cannot be read now: whatever state it reaches next is new. */
  unreadable(sessionId: string): void {
    const tracked = this.tracked.get(sessionId)
    if (tracked) {
      tracked.stamp = null
      tracked.workingSince = null
    }
  }

  /** Running or parked on its own work: the turn's end brings the pass that settles it. */
  turnRuns(session: LiveSession): void {
    const tracked = this.track(session.id)
    tracked.stamp = null
    tracked.workingSince ??= this.now()
    const parked = isParked(session)
    // A timer set for another state of the turn would read it too late, or ask too much of it.
    if (tracked.timer && tracked.timer.for !== (parked ? 'parked' : 'working')) {
      tracked.timer.cancel()
      tracked.timer = null
    }
    this.scheduleWorking(session.id, tracked, parked)
  }

  /**
   * The turn is over. A session that ended gets its last pass when this host watched it run; the
   * history a scan lists is recapped when someone opens it.
   */
  turnEnded(session: LiveSession): void {
    const tracked = session.alive ? this.track(session.id) : this.tracked.get(session.id)
    if (!tracked) {
      return
    }
    tracked.workingSince = null
    const stamp = `${session.status}:${session.lastActivityAt}`
    if (tracked.stamp === stamp) {
      return
    }
    tracked.stamp = stamp
    tracked.due = true
    this.schedule(session.id, tracked)
  }

  /** The utility model came back: sessions that stopped while it was away are due again. */
  resume(): void {
    for (const [sessionId, tracked] of this.tracked) {
      if (tracked.stamp !== null && tracked.due && !tracked.timer) {
        this.schedule(sessionId, tracked)
      }
    }
  }

  /** A pass for the user, now. */
  ask(sessionId: string, rebuild: boolean): Promise<RecapPassOutcome> {
    return this.run(sessionId, this.track(sessionId), 'asked', rebuild)
  }

  /** How the session's last pass went; null before its first. */
  outcome(sessionId: string): RecapPassOutcome | null {
    return this.tracked.get(sessionId)?.outcome ?? null
  }

  /** The session's last activity that a pass has read up to, whether or not it wrote anything. */
  readThrough(sessionId: string): number {
    return this.tracked.get(sessionId)?.readThrough ?? 0
  }

  available(): boolean {
    return this.deps.enabled() && this.deps.pausedUntil() === null
  }

  /**
   * Opening starts a pass whenever the recap is behind, with two limits: a turn still running is
   * always behind, and a pass that just failed would fail again.
   */
  mayStartOnOpening(sessionId: string, turnEnded: boolean): boolean {
    const tracked = this.tracked.get(sessionId)
    if (!tracked) {
      return true
    }
    const wait = !turnEnded
      ? OPEN_INTERVAL_MS
      : tracked.outcome === 'failed'
        ? RECAP_RETRY_DELAYS_MS[0]
        : 0
    return this.now() - Math.max(tracked.lastPassAt, tracked.lastWorkingPassAt) >= wait
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

  private track(sessionId: string): Tracked {
    let tracked = this.tracked.get(sessionId)
    if (!tracked) {
      tracked = {
        stamp: null,
        workingSince: null,
        timer: null,
        lastPassAt: 0,
        lastWorkingPassAt: 0,
        outcome: null,
        readThrough: 0,
        failures: 0,
        due: false
      }
      this.tracked.set(sessionId, tracked)
    }
    return tracked
  }

  private arm(tracked: Tracked, purpose: TimerPurpose, delayMs: number, run: () => void): void {
    tracked.timer?.cancel()
    const timer = this.setTimer(() => {
      tracked.timer = null
      run()
    }, delayMs)
    tracked.timer = { cancel: timer.cancel, for: purpose }
  }

  /** A pass for a turn's end: soon after it, and not sooner after the last one than turns share. */
  private schedule(sessionId: string, tracked: Tracked): void {
    // One pass per turn end: the pass already waiting reads whatever is written when it runs.
    if (tracked.timer?.for === 'rest') {
      return
    }
    const gap = Math.max(RECAP_TURN_END_SHARE_MS, this.deps.turnEndIntervalMs?.() ?? 0)
    this.armRest(
      sessionId,
      tracked,
      Math.max(SETTLE_DELAY_MS, tracked.lastPassAt + gap - this.now())
    )
  }

  private armRest(sessionId: string, tracked: Tracked, delayMs: number): void {
    this.arm(tracked, 'rest', delayMs, () => {
      // Still the rest it was scheduled for; a session back at work is recapped as it works.
      if (this.tracked.get(sessionId) !== tracked || tracked.stamp === null || !tracked.due) {
        return
      }
      if (!this.deps.enabled()) {
        return
      }
      const pausedUntil = this.deps.pausedUntil()
      if (pausedUntil !== null) {
        this.armRest(sessionId, tracked, this.untilPauseEnds(pausedUntil))
        return
      }
      void this.run(sessionId, tracked, 'auto', false)
    })
  }

  private untilPauseEnds(pausedUntil: number): number {
    return Math.max(0, pausedUntil - this.now()) + PAUSE_END_MARGIN_MS
  }

  /** A working turn's passes count from its start, or from the last pass of any kind since. */
  private workingBase(tracked: Tracked): number {
    return Math.max(tracked.workingSince ?? 0, tracked.lastPassAt, tracked.lastWorkingPassAt)
  }

  /**
   * While a turn runs: a look at what the session has said since its recap, once a pass may follow.
   * A turn parked on its own work has said what it will for now, so it is read soon after it parks.
   */
  private scheduleWorking(sessionId: string, tracked: Tracked, parked: boolean): void {
    if (tracked.timer) {
      return
    }
    const wait = parked
      ? Math.max(
          SETTLE_DELAY_MS,
          Math.max(tracked.lastPassAt, tracked.lastWorkingPassAt) +
            RECAP_AUTO_INTERVAL_MS -
            this.now()
        )
      : Math.max(WORKING_CHECK_MS, this.workingBase(tracked) + RECAP_AUTO_INTERVAL_MS - this.now())
    this.armWorking(sessionId, tracked, wait, parked)
  }

  private armWorking(sessionId: string, tracked: Tracked, delayMs: number, parked: boolean): void {
    this.arm(tracked, parked ? 'parked' : 'working', delayMs, () => {
      if (
        this.tracked.get(sessionId) === tracked &&
        tracked.workingSince !== null &&
        this.available()
      ) {
        void this.runWorking(sessionId, tracked, parked)
      }
    })
  }

  private async runWorking(sessionId: string, tracked: Tracked, parked: boolean): Promise<void> {
    const overdue = this.now() - this.workingBase(tracked) >= RECAP_WORKING_MAX_WAIT_MS
    const readThrough = this.deps.session(sessionId)?.lastActivityAt ?? 0
    const outcome = await this.deps.engine.update(
      sessionId,
      'working',
      false,
      overdue || parked ? 1 : RECAP_WORKING_MIN_PROSE_CHARS
    )
    if (outcome === 'current') {
      // Too little said yet: the next activity looks again, and so does the end of the longest wait.
      const left = this.workingBase(tracked) + RECAP_WORKING_MAX_WAIT_MS - this.now()
      if (!overdue && !parked && tracked.workingSince !== null && !tracked.timer) {
        this.armWorking(sessionId, tracked, Math.max(WORKING_CHECK_MS, left), false)
      }
      return
    }
    tracked.lastWorkingPassAt = this.now()
    // Out of the working tier is not out of budget for the user, who can still open or refresh.
    if (outcome !== 'over-budget') {
      tracked.outcome = outcome
    }
    if (outcome === 'updated' || outcome === 'degraded') {
      tracked.readThrough = Math.max(tracked.readThrough, readThrough)
    }
  }

  private run(
    sessionId: string,
    tracked: Tracked,
    kind: 'auto' | 'asked',
    rebuild: boolean
  ): Promise<RecapPassOutcome> {
    const previousPassAt = tracked.lastPassAt
    const startedAt = this.now()
    const readThrough = this.deps.session(sessionId)?.lastActivityAt ?? 0
    tracked.lastPassAt = startedAt
    return this.deps.engine.update(sessionId, kind, rebuild).then((outcome) => {
      tracked.outcome = outcome
      // A chat opened before its first turn has nothing to recap: that is no pass to wait out.
      if (outcome === 'empty' && tracked.lastPassAt === startedAt) {
        tracked.lastPassAt = previousPassAt
      }
      if (outcome === 'failed') {
        this.retry(sessionId, tracked)
        return outcome
      }
      tracked.failures = 0
      if (outcome !== 'over-budget') {
        tracked.due = false
        tracked.readThrough = Math.max(tracked.readThrough, readThrough)
      }
      return outcome
    })
  }

  /** A failed pass at rest is tried again: when the pause ends, else after the next retry delay. */
  private retry(sessionId: string, tracked: Tracked): void {
    if (this.tracked.get(sessionId) !== tracked || tracked.stamp === null || tracked.timer) {
      return
    }
    tracked.due = true
    const pausedUntil = this.deps.pausedUntil()
    if (pausedUntil !== null) {
      this.armRest(sessionId, tracked, this.untilPauseEnds(pausedUntil))
      return
    }
    const delay = RECAP_RETRY_DELAYS_MS[tracked.failures]
    if (delay !== undefined) {
      tracked.failures += 1
      this.armRest(sessionId, tracked, delay)
    }
  }
}

/** The turn is not over, and the agent has stopped writing until its own work or an approval comes back. */
function isParked(session: LiveSession): boolean {
  return isWaitingOnBackgroundWork(session.status) || session.status === 'needs-permission'
}
