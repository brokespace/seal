// How a request is shown, decided by code from what the host stored: desktop, mobile and the row
// badge all read it here. "Not addressed" needs the judge's explicit verdict; everything else that
// is unsettled is "Open".
import type { LiveSessionStatus } from '../live-sessions/live-session-types'
import type {
  RecapMarks,
  RecapRequest,
  RecapRequestStatus,
  SessionRecap
} from './session-recap-types'

export const RECAP_REQUEST_DISPLAYS = [
  /** The turn it belongs to is still running or parked: nothing is claimed about it yet. */
  'in-progress',
  /** Unsettled and unproven: the default, and what every failure falls back to. */
  'open',
  /** The judge said it is still waiting, after its turn ended, on complete and current evidence. */
  'not-addressed',
  'partly',
  'declined',
  'done',
  'withdrawn'
] as const
export type RecapRequestDisplay = (typeof RECAP_REQUEST_DISPLAYS)[number]

const TURN_ENDED: Record<LiveSessionStatus, boolean> = {
  working: false,
  'running-shell': false,
  // Parked on a subagent, a background task or an approval: the turn picks up again by itself.
  'waiting-subagent': false,
  'waiting-task': false,
  'needs-permission': false,
  'waiting-input': true,
  'your-turn': true,
  idle: true,
  errored: true,
  done: true
}

/** Whether the session's turn is over, which a request must be before it can be "Not addressed". */
export function recapTurnHasEnded(status: LiveSessionStatus): boolean {
  return TURN_ENDED[status]
}

const SETTLED: Record<Exclude<RecapRequestStatus, 'open'>, RecapRequestDisplay> = {
  addressed: 'done',
  partly: 'partly',
  declined: 'declined',
  withdrawn: 'withdrawn'
}

export type RecapRequestDisplayContext = {
  /** The recap's own cursor: a verdict about an earlier end of the conversation proves nothing now. */
  coveredTo: number
  /** The session's turn is over now. Unknown counts as not over. */
  turnEnded: boolean
  /** The transcript has moved past what the recap covers. */
  stale: boolean
}

export function recapRequestDisplay(
  request: RecapRequest,
  context: RecapRequestDisplayContext
): RecapRequestDisplay {
  if (request.status !== 'open') {
    return SETTLED[request.status]
  }
  if (!context.turnEnded) {
    return 'in-progress'
  }
  const { judged } = request
  return judged &&
    judged.leftUndone &&
    judged.turnEnded &&
    judged.complete &&
    judged.coveredTo === context.coveredTo &&
    !context.stale
    ? 'not-addressed'
    : 'open'
}

/** The requests to list under "Not addressed", oldest first; the user's dismissals stay out. */
export function recapNotAddressedRequests(
  recap: SessionRecap | null,
  marks: RecapMarks,
  context: Omit<RecapRequestDisplayContext, 'coveredTo'>
): RecapRequest[] {
  return (recap?.requests ?? []).filter(
    (request) =>
      marks[request.id] === undefined &&
      recapRequestDisplay(request, { ...context, coveredTo: recap?.coveredTo ?? 0 }) ===
        'not-addressed'
  )
}
