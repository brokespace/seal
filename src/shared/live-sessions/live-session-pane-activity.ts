// A Seal pane's hook row and its session are one agent. Where discovery had the say over the row
// (background work the hooks never reported, a turn they left open), every roll-up of the pane, the
// tab glyph and the workspace dot, reads the session, so they agree with its row in Active agents.
import type { AgentPaneActivityFlags } from '../worktree-status-rollup'
import { isTurnRunningLiveSessionStatus } from './live-session-status'
import type { LiveSession, LiveSessionStatus } from './live-session-types'

export type LiveSessionPaneStatuses = ReadonlyMap<string, LiveSessionStatus>

/** The status of each pane session that discovery, not the pane's hook row, decided. */
export function liveSessionPaneStatuses(
  sessions: readonly Pick<LiveSession, 'inputRoutes' | 'status' | 'statusSource'>[]
): Map<string, LiveSessionStatus> {
  const statuses = new Map<string, LiveSessionStatus>()
  for (const session of sessions) {
    if (session.statusSource === 'seal-hooks') {
      continue
    }
    for (const route of session.inputRoutes) {
      if (route.kind === 'seal-pane') {
        statuses.set(route.paneKey, session.status)
      }
    }
  }
  return statuses
}

/** Rolls a pane up as its session shows it; false leaves the pane to its hook row. */
export function applyLiveSessionPaneFlags(
  flags: AgentPaneActivityFlags,
  status: LiveSessionStatus | undefined
): boolean {
  if (status === undefined || status === 'idle' || status === 'done') {
    return false
  }
  if (status === 'needs-permission' || status === 'waiting-input') {
    flags.hasPermission = true
  } else if (status === 'errored') {
    flags.hasFailed = true
  } else if (status === 'waiting-task') {
    flags.hasLiveMonitoring = true
  } else if (isTurnRunningLiveSessionStatus(status) || status === 'waiting-subagent') {
    flags.hasLiveWorking = true
  } else {
    flags.hasLiveDone = true
  }
  return true
}
