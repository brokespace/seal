import type { SplitViewEdge, SplitViewItem } from './split-view-types'

/** What a tab of items does when pressed, closed or moved; a pane and the agent-session page each say. */
export type ItemTabCommands = {
  activate: (item: SplitViewItem) => void
  /** A preview tab becomes a kept one. */
  keep: (item: SplitViewItem) => void
  close: (item: SplitViewItem) => void
  /** Absent on the agent-session page, whose tabs keep the session's own menu only. */
  closeOthers?: (item: SplitViewItem) => void
  closePane?: () => void
  moveToNewPane?: (item: SplitViewItem, edge: SplitViewEdge) => void
}
