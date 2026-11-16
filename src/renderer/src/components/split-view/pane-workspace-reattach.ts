import { useAppStore } from '@/store/index'
import { hasRegisteredRuntimeTerminalTab } from '@/runtime/hosted-terminals/mounted-surfaces/mounted-terminal-tab-registry'
import {
  areTabSessionsConfirmed,
  planTerminalPrewarmTabMount
} from '../terminal/terminal-worktree-prewarm'
import {
  confirmLiveTabSessions,
  resolveReattachPtyIds,
  selectGroupActiveTerminalTabIds,
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
  // A workspace with no tab group shows nothing until focus opens it.
  if ((state.groupsByWorktree[worktreeId] ?? []).length === 0) {
    return null
  }
  // Restricting the surface drops a simulator's overlay and loses its local state.
  if (
    (state.unifiedTabsByWorktree[worktreeId] ?? []).some((tab) => tab.contentType === 'simulator')
  ) {
    return null
  }
  const tabs = state.tabsByWorktree[worktreeId] ?? []
  const revealTabIds = selectGroupActiveTerminalTabIds(state, worktreeId)
  if (revealTabIds.size === 0) {
    return []
  }
  const sleepingTabIds = selectSleepingTabIds(state, worktreeId)
  const isTabLive = (tabId: string): boolean => hasRegisteredRuntimeTerminalTab(tabId, worktreeId)
  const isTabSleeping = (tabId: string): boolean => sleepingTabIds.has(tabId)
  const confirmedPtyIdsByTabId = await confirmLiveTabSessions(
    tabs.filter((tab) => revealTabIds.has(tab.id) && !isTabLive(tab.id) && !isTabSleeping(tab.id)),
    state
  )
  const plan = planTerminalPrewarmTabMount({
    tabs,
    revealTabIds,
    isTabLive,
    // A pane keeps what it mounts on screen, so nothing here has to be parkable again.
    isTabRestorable: () => true,
    isTabSleeping,
    isSessionConfirmedLive: (tab) =>
      areTabSessionsConfirmed(resolveReattachPtyIds(tab, state), confirmedPtyIdsByTabId.get(tab.id))
  })
  // One tab group left blank beside a loaded one would read as broken.
  if (!plan || [...revealTabIds].some((tabId) => !plan.allowedTabIds.has(tabId))) {
    return null
  }
  // A mount request that names a sleeping tab asks its agent to wake.
  return [...plan.allowedTabIds].filter((tabId) => !isTabSleeping(tabId))
}
