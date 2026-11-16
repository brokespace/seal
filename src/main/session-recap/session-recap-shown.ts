// What clients are shown of a recap this host or a paired server keeps: the list under "Not
// addressed", the brief on the session's row, and the state the panel draws.
import {
  openRecapItems,
  type LiveSessionRecapBrief,
  type RecapMarks,
  type SessionRecap,
  type SessionRecapState
} from '../../shared/session-recap/session-recap-types'
import { recapNotAddressedRequests } from '../../shared/session-recap/session-recap-request-display'

/**
 * The recap as clients draw it. `ignored` is the list under "Not addressed": only requests the
 * judge found still waiting, never what the read step proposed.
 */
export function shownRecap(
  recap: SessionRecap,
  context: { turnEnded: boolean; stale: boolean }
): SessionRecap {
  // Dismissed ones stay listed, as ticked items do: the panel draws them settled.
  const everyMark: RecapMarks = {}
  return {
    ...recap,
    ignored: recapNotAddressedRequests(recap, everyMark, context).map((request) => ({
      id: request.id,
      text: request.text,
      messageId: request.messageId,
      at: request.judged?.at ?? request.statusAt
    }))
  }
}

/** The row's brief for a recap as shown; null when there is neither a recap nor a pass running. */
export function recapBrief(
  shown: SessionRecap | null,
  marks: RecapMarks,
  rev: number,
  updating: boolean
): LiveSessionRecapBrief | null {
  if (!shown && !updating) {
    return null
  }
  const brief: LiveSessionRecapBrief = {
    title: shown?.title ?? null,
    rev,
    questions: shown ? openRecapItems(shown.questions, marks).length : 0,
    actions: shown ? openRecapItems(shown.actions, marks).length : 0
  }
  const notAddressed = shown ? openRecapItems(shown.ignored, marks).length : 0
  if (notAddressed > 0) {
    brief.notAddressed = notAddressed
  }
  if (updating) {
    brief.updating = true
  }
  return brief
}

/** The state a client draws for a session's recap on this host. */
export function recapViewState(at: {
  /** Recaps are on and this host has a utility model. */
  enabled: boolean
  updating: boolean
  hasRecap: boolean
  stale: boolean
  paused: boolean
  /** The last pass failed and its failure still stands. */
  failed: boolean
  overBudget: boolean
}): SessionRecapState {
  if (!at.enabled) {
    return 'unavailable'
  }
  if (at.updating) {
    return 'updating'
  }
  // A recap that covers everything is ready whatever stopped the pass after it.
  if (at.hasRecap && !at.stale) {
    return 'ready'
  }
  if (at.paused) {
    return 'paused'
  }
  if (at.failed) {
    return 'failed'
  }
  if (at.overBudget) {
    return 'over-budget'
  }
  return at.hasRecap ? 'ready' : 'empty'
}
