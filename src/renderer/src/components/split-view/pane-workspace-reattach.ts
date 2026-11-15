import { useAppStore } from '@/store/index'
import { hasRegisteredRuntimeTerminalTab } from '@/runtime/hosted-terminals/mounted-surfaces/mounted-terminal-tab-registry'
import { areTabSessionsConfirmed } from '../terminal/terminal-worktree-prewarm'
import {
  resolveReattachPtyIds,
  selectRevealTerminalTabIds,
  selectSleepingTabIds
} from '../terminal/terminal-worktree-prewarm-targets'

/**
 * The terminal tabs a visible, unfocused workspace may mount: those on show whose sessions are
 * confirmed alive. Mounting any other starts a shell or wakes an agent, which only focusing the
 * pane may do. Null when a terminal is on show and none of them can be reattached.
 */
export async function resolveReattachableTabIds(worktreeId: string): Promise<string[] | null> {
  const state = useAppStore.getState()
  const revealTabIds = selectRevealTerminalTabIds(state, worktreeId)
  const sleepingTabIds = selectSleepingTabIds(state, worktreeId)
  const tabs = (state.tabsByWorktree[worktreeId] ?? []).filter((tab) => revealTabIds.has(tab.id))
  if (tabs.length === 0) {
    return []
  }
  const reattachable = await Promise.all(
    tabs.map(async (tab) => {
      if (hasRegisteredRuntimeTerminalTab(tab.id, worktreeId)) {
        return true
      }
      if (sleepingTabIds.has(tab.id)) {
        return false
      }
      // A mount reconnects every leaf of the tab, so each leaf's session has to be alive.
      const ptyIds = resolveReattachPtyIds(tab, state)
      const answers = await Promise.all(
        ptyIds.map((ptyId) => window.api.pty.hasPty(ptyId).catch(() => null))
      )
      // Unknown (a remote runtime) is not a yes.
      const confirmed = new Set(ptyIds.filter((_ptyId, index) => answers[index] === true))
      return areTabSessionsConfirmed(ptyIds, confirmed)
    })
  )
  const tabIds = tabs.filter((_tab, index) => reattachable[index]).map((tab) => tab.id)
  return tabIds.length > 0 ? tabIds : null
}
