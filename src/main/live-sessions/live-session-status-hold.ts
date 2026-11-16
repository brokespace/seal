import { liveSessionStatusGroup } from '../../shared/live-sessions/live-session-status'
import type {
  LiveSession,
  LiveSessionStatusSource
} from '../../shared/live-sessions/live-session-types'

// With the activity it was read with: what a waiting session waits on is counted from it.
type Shown = Pick<
  LiveSession,
  'status' | 'statusSource' | 'statusDetail' | 'permission' | 'activity'
>

type Held = {
  shown: Shown
  /** A status waiting to be confirmed, and the host scan it was first read in. */
  pending: { status: LiveSession['status']; scan: number; since: number } | null
}

/** Readings of a moment in time; a hook event or a dialog on screen is the event itself. */
const INFERRED: ReadonlySet<LiveSessionStatusSource> = new Set([
  'transcript',
  'process',
  'classifier'
])
/** A scan that never comes (a host that stopped answering) must not pin a session to "working". */
const MAX_HOLD_MS = 20_000

/**
 * Keeps a busy session busy until a second scan agrees it stopped. Between a tool result and the
 * next call, or while a process list is cut short, one scan can read a working agent as finished;
 * shown at once, that flickers and fires a "finished" notice for a turn that is still running.
 * A prompt or an error is never held: those are shown the moment they are read.
 */
export class LiveSessionStatusHold {
  private readonly held = new Map<string, Held>()

  /** `scan` counts the completed scans of the session's host. */
  settle(session: LiveSession, scan: number, now: number): LiveSession {
    const had = this.held.get(session.id)
    const leavesBusy =
      had !== undefined &&
      liveSessionStatusGroup(had.shown.status) === 'working' &&
      liveSessionStatusGroup(session.status) !== 'working' &&
      session.status !== 'needs-permission' &&
      session.status !== 'errored' &&
      INFERRED.has(session.statusSource)
    if (!leavesBusy) {
      this.held.set(session.id, { shown: shownOf(session), pending: null })
      return session
    }
    const pending =
      had.pending?.status === session.status
        ? had.pending
        : { status: session.status, scan, since: now }
    if (scan > pending.scan || now - pending.since >= MAX_HOLD_MS) {
      this.held.set(session.id, { shown: shownOf(session), pending: null })
      return session
    }
    had.pending = pending
    return { ...session, ...had.shown }
  }

  /** Forget sessions that are gone. */
  keep(sessionIds: ReadonlySet<string>): void {
    for (const id of this.held.keys()) {
      if (!sessionIds.has(id)) {
        this.held.delete(id)
      }
    }
  }
}

function shownOf(session: LiveSession): Shown {
  return {
    status: session.status,
    statusSource: session.statusSource,
    statusDetail: session.statusDetail,
    permission: session.permission,
    activity: session.activity
  }
}
