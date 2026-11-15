import { useAppStore } from '@/store/index'
import { hasRegisteredRuntimeTerminalTab } from '@/runtime/hosted-terminals/mounted-surfaces/mounted-terminal-tab-registry'
import type { TerminalTab } from '../../../../shared/workspace-layout/terminal-tab-types'
import { canWatcherCoverParkedTerminalTab } from '../terminal-pane/parking/output-watchers/parked-terminal-tab-coverage'
import {
  areTabSessionsConfirmed,
  planTerminalPrewarmTabMount
} from '../terminal/terminal-worktree-prewarm'
import {
  confirmLiveTabSessions,
  resolveReattachPtyIds,
  selectRevealTerminalTabIds,
  selectSleepingTabIds
} from '../terminal/terminal-worktree-prewarm-targets'

/**
 * The terminal tabs a visible, unfocused workspace may mount, by the rule a hover prewarm
 * follows: only sessions the daemon confirms alive. Mounting any other starts a shell or wakes
 * an agent, which only focusing the pane may do. Null when what is on show has to wait for
 * that focus; empty when no terminal is on show.
 */
export async function resolveReattachableTabIds(worktreeId: string): Promise<string[] | null> {
  const state = useAppStore.getState()
  const tabs = state.tabsByWorktree[worktreeId] ?? []
  const revealTabIds = selectRevealTerminalTabIds(state, worktreeId)
  if (!tabs.some((tab) => revealTabIds.has(tab.id))) {
    // A workspace with no tab group shows nothing until focus opens it.
    return (state.groupsByWorktree[worktreeId] ?? []).length > 0 ? [] : null
  }
  // Restricting the surface drops a simulator's overlay and loses its local state.
  if (
    (state.unifiedTabsByWorktree[worktreeId] ?? []).some((tab) => tab.contentType === 'simulator')
  ) {
    return null
  }
  const sleepingTabIds = selectSleepingTabIds(state, worktreeId)
  const isTabLive = (tabId: string): boolean => hasRegisteredRuntimeTerminalTab(tabId, worktreeId)
  const isTabRestorable = (tab: TerminalTab): boolean =>
    canWatcherCoverParkedTerminalTab(worktreeId, tab)
  const isTabSleeping = (tabId: string): boolean => sleepingTabIds.has(tabId)
  const confirmedPtyIdsByTabId = await confirmLiveTabSessions(
    tabs.filter(
      (tab) =>
        revealTabIds.has(tab.id) &&
        !isTabLive(tab.id) &&
        !isTabSleeping(tab.id) &&
        isTabRestorable(tab)
    ),
    state
  )
  const plan = planTerminalPrewarmTabMount({
    tabs,
    revealTabIds,
    isTabLive,
    isTabRestorable,
    isTabSleeping,
    isSessionConfirmedLive: (tab) =>
      areTabSessionsConfirmed(resolveReattachPtyIds(tab, state), confirmedPtyIdsByTabId.get(tab.id))
  })
  // A mount request that names a sleeping tab asks its agent to wake.
  return plan ? [...plan.allowedTabIds].filter((tabId) => !isTabSleeping(tabId)) : null
}
