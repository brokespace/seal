import type { TabGroupLayoutNode } from '../../../../shared/tab-types'
import { settleSplitView } from './split-view-layout-transitions'
import {
  EMPTY_SPLIT_VIEW,
  splitViewItemKey,
  type SplitViewItem,
  type SplitViewPane,
  type SplitViewState
} from './split-view-types'

export const SPLIT_VIEW_STORAGE_KEY = 'seal.splitView.v1'

type SavedSplitView = {
  layout: TabGroupLayoutNode
  panes: Record<string, { items: SplitViewItem[]; activeKey: string | null }>
  focusedPaneId: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseItem(value: unknown): SplitViewItem | null {
  if (!isRecord(value)) {
    return null
  }
  const text = (key: string): string | null => {
    const field = value[key]
    return typeof field === 'string' && field.length > 0 ? field : null
  }
  const hostId = text('hostId')
  if (value.kind === 'workspace') {
    const worktreeId = text('worktreeId')
    return worktreeId ? { kind: 'workspace', worktreeId, hostId } : null
  }
  if (value.kind === 'session') {
    const sessionId = text('sessionId')
    return sessionId ? { kind: 'session', sessionId } : null
  }
  if (value.kind === 'project') {
    const repoId = text('repoId')
    return repoId && hostId ? { kind: 'project', repoId, hostId } : null
  }
  return null
}

/** A subtree with no usable pane is dropped and its sibling takes the space. */
function parseLayout(value: unknown, seen: Set<string>): TabGroupLayoutNode | null {
  if (!isRecord(value)) {
    return null
  }
  if (value.type === 'leaf') {
    const groupId = value.groupId
    if (typeof groupId !== 'string' || groupId.length === 0 || seen.has(groupId)) {
      return null
    }
    seen.add(groupId)
    return { type: 'leaf', groupId }
  }
  if (value.type !== 'split') {
    return null
  }
  const first = parseLayout(value.first, seen)
  const second = parseLayout(value.second, seen)
  if (!first || !second) {
    return first ?? second
  }
  const ratio = value.ratio
  return {
    type: 'split',
    direction: value.direction === 'vertical' ? 'vertical' : 'horizontal',
    first,
    second,
    ...(typeof ratio === 'number' && ratio > 0 && ratio < 1 ? { ratio } : {})
  }
}

/** Reads a saved split view, dropping whatever cannot be trusted instead of the whole layout. */
export function parseSavedSplitView(raw: string | null | undefined): SplitViewState {
  let saved: unknown
  try {
    saved = JSON.parse(raw ?? 'null')
  } catch {
    return EMPTY_SPLIT_VIEW
  }
  if (!isRecord(saved)) {
    return EMPTY_SPLIT_VIEW
  }
  const layout = parseLayout(saved.layout, new Set())
  const savedPanes = isRecord(saved.panes) ? saved.panes : {}
  const panes: Record<string, SplitViewPane> = {}
  for (const [paneId, savedPane] of Object.entries(savedPanes)) {
    if (!isRecord(savedPane) || !Array.isArray(savedPane.items)) {
      continue
    }
    const tabs = savedPane.items
      .map(parseItem)
      .filter((item): item is SplitViewItem => item !== null)
      // Preview flags are not saved: restored chips are kept.
      .map((item) => ({ item, preview: false }))
    panes[paneId] = {
      tabs,
      activeKey: typeof savedPane.activeKey === 'string' ? savedPane.activeKey : null
    }
  }
  // settle drops panes with no chips, items saved twice, and a focus that names no pane.
  return settleSplitView({
    layout,
    panes,
    focusedPaneId: typeof saved.focusedPaneId === 'string' ? saved.focusedPaneId : null,
    maximizedPaneId: null
  })
}

export function serializeSplitView(state: SplitViewState): string | null {
  if (!state.layout) {
    return null
  }
  const saved: SavedSplitView = {
    layout: state.layout,
    panes: Object.fromEntries(
      Object.entries(state.panes).map(([paneId, pane]) => [
        paneId,
        { items: pane.tabs.map((tab) => tab.item), activeKey: pane.activeKey }
      ])
    ),
    focusedPaneId: state.focusedPaneId
  }
  return JSON.stringify(saved)
}

/** A two-up saved by the session page before split view existed becomes two panes. */
export function splitViewFromSessionTwoUp(
  sessionIds: readonly string[],
  activeId: string | null,
  splitId: string | null,
  paneIds: { first: string; second: string }
): SplitViewState {
  if (!splitId || !activeId || splitId === activeId || !sessionIds.includes(splitId)) {
    return EMPTY_SPLIT_VIEW
  }
  const item = (sessionId: string): SplitViewItem => ({ kind: 'session', sessionId })
  const rest = sessionIds.filter((id) => id !== splitId).map(item)
  return settleSplitView({
    layout: {
      type: 'split',
      direction: 'horizontal',
      first: { type: 'leaf', groupId: paneIds.first },
      second: { type: 'leaf', groupId: paneIds.second },
      ratio: 0.5
    },
    panes: {
      [paneIds.first]: {
        tabs: rest.map((sessionItem) => ({ item: sessionItem, preview: false })),
        activeKey: splitViewItemKey(item(activeId))
      },
      [paneIds.second]: {
        tabs: [{ item: item(splitId), preview: false }],
        activeKey: splitViewItemKey(item(splitId))
      }
    },
    focusedPaneId: paneIds.first,
    maximizedPaneId: null
  })
}
