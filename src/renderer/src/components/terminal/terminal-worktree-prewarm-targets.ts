import { sleepingAgentRecordIndex } from '@/store/terminals/sleep/sleeping-agent-record-index'
import { getSleepingRecordTabId } from '@/lib/agent-session/resume/sleeping-agent-wake-requests'
import '../terminal-pane/parking/output-watchers/terminal-parked-tab-watchers'
import { parkedTerminalTabCoverage } from '../terminal-pane/parking/output-watchers/parked-terminal-tab-coverage'
import type { AppState } from '@/store/types'
import type { TerminalTab } from '../../../../shared/workspace-layout/terminal-tab-types'

export function selectRevealTerminalTabIds(state: AppState, worktreeId: string): Set<string> {
  const revealTabIds = new Set<string>()
  const unifiedTabById = new Map(
    (state.unifiedTabsByWorktree[worktreeId] ?? []).map((tab) => [tab.id, tab])
  )
  for (const group of state.groupsByWorktree[worktreeId] ?? []) {
    const tab = group.activeTabId ? unifiedTabById.get(group.activeTabId) : undefined
    if (tab?.contentType === 'terminal') {
      revealTabIds.add(tab.entityId)
    }
  }
  const rememberedTabId = state.activeTabIdByWorktree[worktreeId]
  if (revealTabIds.size === 0 && rememberedTabId) {
    revealTabIds.add(rememberedTabId)
  }
  return revealTabIds
}

export function selectSleepingTabIds(state: AppState, worktreeId: string): Set<string> {
  const tabIds = new Set<string>()
  for (const record of sleepingAgentRecordIndex
    .entries(state.sleepingAgentSessionsByPaneKey, worktreeId)
    .map(([, record]) => record)) {
    const tabId = record.worktreeId === worktreeId ? getSleepingRecordTabId(record) : null
    if (tabId) {
      tabIds.add(tabId)
    }
  }
  return tabIds
}

// Each stage waits for an idle slot after the previous commit; the timeout keeps it ready before a typical press.
export function scheduleTerminalPrewarmStage(callback: () => void): () => void {
  if (typeof requestIdleCallback !== 'function') {
    const timer = setTimeout(callback, 16)
    return () => clearTimeout(timer)
  }
  const handle = requestIdleCallback(callback, { timeout: 60 })
  return () => cancelIdleCallback(handle)
}

export function resolveReattachPtyIds(tab: TerminalTab, state: AppState): string[] {
  return parkedTerminalTabCoverage(tab.worktreeId, tab, state).panes.flatMap((pane) =>
    pane.ptyId ? [pane.ptyId] : []
  )
}

/** Each tab's sessions the daemon confirms alive. */
export async function confirmLiveTabSessions(
  tabs: readonly TerminalTab[],
  state: AppState
): Promise<Map<string, ReadonlySet<string>>> {
  const confirmedByTab = await Promise.all(
    tabs.map(async (tab) => {
      // Mounting reconnects every leaf, so each leaf's session must be live, not just the tab's.
      const ptyIds = resolveReattachPtyIds(tab, state)
      const answers = await Promise.all(
        ptyIds.map((ptyId) => window.api.pty.hasPty(ptyId).catch(() => null))
      )
      // Only an authoritative true counts: null (unknown, remote runtime) must not authorize a reattach.
      const confirmed = new Set(ptyIds.filter((_ptyId, index) => answers[index] === true))
      return [tab.id, confirmed] as const
    })
  )
  return new Map(confirmedByTab)
}
