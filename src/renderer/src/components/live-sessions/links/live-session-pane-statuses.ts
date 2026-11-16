import {
  liveSessionPaneStatuses,
  type LiveSessionPaneStatuses
} from '../../../../../shared/live-sessions/live-session-pane-activity'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { liveSessionRegistryStore } from '../live-session-registry-store'

let memo: { sessions: readonly LiveSession[]; statuses: LiveSessionPaneStatuses } = {
  sessions: [],
  statuses: new Map()
}

/** Pane sessions whose status discovery decided; keeps its identity until one of them changes. */
export function currentLiveSessionPaneStatuses(): LiveSessionPaneStatuses {
  const { sessions } = liveSessionRegistryStore.getState()
  if (sessions !== memo.sessions) {
    const next = liveSessionPaneStatuses(sessions)
    const same =
      next.size === memo.statuses.size &&
      [...next].every(([paneKey, status]) => memo.statuses.get(paneKey) === status)
    memo = { sessions, statuses: same ? memo.statuses : next }
  }
  return memo.statuses
}
