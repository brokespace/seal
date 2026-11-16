import type { SplitViewEdge, SplitViewItem } from './split-view-types'

/** What a pane's tab of items does when pressed, closed or moved. */
export type ItemTabCommands = {
  activate: (item: SplitViewItem) => void
  /** A preview tab becomes a kept one. */
  keep: (item: SplitViewItem) => void
  close: (item: SplitViewItem) => void
  closeOthers: (item: SplitViewItem) => void
  closePane: () => void
  moveToNewPane: (item: SplitViewItem, edge: SplitViewEdge) => void
}
