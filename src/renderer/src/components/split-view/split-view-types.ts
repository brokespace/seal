import type { TabGroupLayoutNode } from '../../../../shared/tab-types'

/** Something the sidebar opens, shown in a pane. */
export type SplitViewItem =
  // Why worktreeId alone: one workspace surface exists per id, whichever host lists it.
  | { kind: 'workspace'; worktreeId: string; hostId: string | null }
  | { kind: 'project'; repoId: string; hostId: string }

export type SplitViewTab = { item: SplitViewItem; preview: boolean }

export type SplitViewPane = { tabs: SplitViewTab[]; activeKey: string | null }

export type SplitViewState = {
  /** A leaf's groupId is a pane id; null means there is no split view. */
  layout: TabGroupLayoutNode | null
  panes: Record<string, SplitViewPane>
  focusedPaneId: string | null
  /** Not persisted. */
  maximizedPaneId: string | null
}

export type SplitViewEdge = 'left' | 'right' | 'up' | 'down'
export type SplitViewZone = SplitViewEdge | 'center'

/** Where items land: beside a pane, or in its strip (`index` omitted appends). */
export type SplitViewPlacement = { paneId: string; zone: SplitViewZone; index?: number }

/** Where a tab opens: in a workspace (null: the one in view), in front or on an edge beside its tabs. */
export type SplitViewTabPlace = { worktreeId: string | null; zone: SplitViewZone }

export const EMPTY_SPLIT_VIEW: SplitViewState = {
  layout: null,
  panes: {},
  focusedPaneId: null,
  maximizedPaneId: null
}

export function splitViewItemKey(item: SplitViewItem): string {
  switch (item.kind) {
    case 'workspace':
      return `workspace:${item.worktreeId}`
    case 'project':
      return `project:${item.hostId}\n${item.repoId}`
  }
}

export function findSplitViewPaneOfKey(state: SplitViewState, key: string): string | null {
  for (const [paneId, pane] of Object.entries(state.panes)) {
    if (pane.tabs.some((tab) => splitViewItemKey(tab.item) === key)) {
      return paneId
    }
  }
  return null
}

export function activeSplitViewItem(state: SplitViewState, paneId: string): SplitViewItem | null {
  const pane = state.panes[paneId]
  return pane?.tabs.find((tab) => splitViewItemKey(tab.item) === pane.activeKey)?.item ?? null
}
