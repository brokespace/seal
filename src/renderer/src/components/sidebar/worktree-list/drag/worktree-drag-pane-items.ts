import { workspaceSplitViewItem } from '../../../split-view/split-view-commands'
import type { SplitViewItem } from '../../../split-view/split-view-types'
import type { WorktreePointerDrag } from './row-state'

/** The dragged cards as pane items, each on the host of the card that was picked up. */
export function worktreeDragPaneItems(
  drag: Pick<WorktreePointerDrag, 'draggedIds' | 'draggedCopies'>
): SplitViewItem[] {
  return drag.draggedIds.map((id) =>
    workspaceSplitViewItem(drag.draggedCopies.find((copy) => copy.id === id) ?? { id })
  )
}
