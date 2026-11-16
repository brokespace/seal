import { activeAgentsScopeStore } from '../active-agents/active-agents-scope-store'
import type { ActiveAgentsScope } from '../active-agents/active-agents-model'
import { liveSessionMarksStore } from '../live-session-marks-store'

/**
 * Shows a workspace's or project's sessions where the sidebar lists them, as rows under their
 * workspaces: the list unfolds down to that scope's first session and scrolls its row in. The
 * page on screen stays: the list is beside it.
 */
export function showScopeInActiveAgents(
  scope: ActiveAgentsScope,
  firstSessionId: string | undefined
): void {
  // Only recorded: no list narrows by it.
  activeAgentsScopeStore.setScope(scope)
  if (firstSessionId) {
    liveSessionMarksStore.reveal(firstSessionId)
  }
}
