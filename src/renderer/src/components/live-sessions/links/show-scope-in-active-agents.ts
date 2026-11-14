import { activeAgentsFilterStore } from '../active-agents/active-agents-filter-store'
import type { ActiveAgentsScope } from '../active-agents/active-agents-model'
import { liveSessionMarksStore } from '../live-session-marks-store'

/**
 * Narrows the sidebar's Active agents to one workspace or project and unfolds it on that scope's
 * first session. The page on screen stays: the list is beside it.
 */
export function showScopeInActiveAgents(
  scope: ActiveAgentsScope,
  firstSessionId: string | undefined
): void {
  activeAgentsFilterStore.setScope(scope)
  if (firstSessionId) {
    liveSessionMarksStore.reveal(firstSessionId)
  }
}
