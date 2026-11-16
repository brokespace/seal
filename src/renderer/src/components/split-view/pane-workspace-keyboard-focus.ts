import { useAppStore } from '@/store/index'
import {
  resolveModalReturnFocusAction,
  WORKSPACE_FOCUS_SELECTORS
} from '@/hooks/modal-return-focus-action'
import {
  ORCA_BROWSER_FOCUS_REQUEST_EVENT,
  queueBrowserFocusRequest
} from '@/components/browser-pane/host-guest/browser-focus'
import { focusTerminalTabSurface } from '@/components/terminal-pane/input/focus/focus-terminal-tab-surface'
import { toVisibleTabType } from '../../../../shared/tab-types'
import { splitViewStore } from './split-view-store'

function focusFirstMatchInPane(paneId: string, selectors: readonly string[]): void {
  const surface = document.querySelector(`[data-workspace-surface-pane-id="${CSS.escape(paneId)}"]`)
  for (const selector of selectors) {
    const target = surface?.querySelector<HTMLElement>(selector)
    target?.focus({ preventScroll: true })
    if (target && target.contains(document.activeElement)) {
      return
    }
  }
}

/**
 * Puts keyboard input on what a workspace pane has in front. A terminal takes it by itself only
 * when no input holds it, and an editor or a browser page never does.
 */
export function focusWorkspacePaneContent(paneId: string, worktreeId: string): void {
  const state = useAppStore.getState()
  const groups = state.groupsByWorktree[worktreeId] ?? []
  const group =
    groups.find((candidate) => candidate.id === state.activeGroupIdByWorktree[worktreeId]) ??
    groups[0]
  const tab = (state.unifiedTabsByWorktree[worktreeId] ?? []).find(
    (candidate) => candidate.id === group?.activeTabId
  )
  if (!tab) {
    return
  }
  const tabType = toVisibleTabType(tab.contentType)
  const action = resolveModalReturnFocusAction({
    tabType,
    worktreeId,
    browserPageId:
      (state.browserTabsByWorktree[worktreeId] ?? []).find(
        (workspace) => workspace.id === tab.entityId
      )?.activePageId ?? null,
    browserTarget: 'webview',
    terminalTabId: tabType === 'terminal' ? tab.entityId : null,
    terminalLeafId: state.terminalLayoutsByTabId[tab.entityId]?.activeLeafId ?? null
  })
  const stillWanted = (): boolean => splitViewStore.getState().focusedPaneId === paneId
  if (action.kind === 'terminal') {
    focusTerminalTabSurface(action.tabId, action.leafId, {
      onlyIfFocusUnclaimed: true,
      shouldFocus: stillWanted
    })
  } else if (action.kind === 'browser') {
    const detail = { pageId: action.pageId, target: action.target }
    queueBrowserFocusRequest(detail)
    window.dispatchEvent(new CustomEvent(ORCA_BROWSER_FOCUS_REQUEST_EVENT, { detail }))
  } else if (action.kind !== 'none') {
    const selectors = WORKSPACE_FOCUS_SELECTORS[action.kind]
    // The surface moves over its pane after this pane takes focus.
    requestAnimationFrame(() => {
      if (stillWanted() && document.activeElement === document.body) {
        focusFirstMatchInPane(paneId, selectors)
      }
    })
  }
}
