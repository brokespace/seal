import type { Repo } from '../../../../../../shared/repo-types'
import { projectOverviewTargetFor } from '@/store/slices/ui/project-overview-target'
import {
  beginSplitViewDrag,
  commitSplitViewDrop,
  trackSplitViewDrop
} from '../../../split-view/split-view-drop-target'
import type { SplitViewItem } from '../../../split-view/split-view-types'
import {
  createSidebarDragPreview,
  updateSidebarDragPreviewPosition
} from './worktree-sidebar-pointer-drag-dom'

/** A project-header drag's hand-off to split-view panes while the pointer is over the main area. */
export type ProjectHeaderPaneDrop = {
  /** Shows where a release would land. False while the sidebar keeps the drag. */
  track: (x: number, y: number) => boolean
  /** Commits a release. False when no pane took the project. */
  commit: (x: number, y: number) => boolean
  end: () => void
}

export function beginProjectHeaderPaneDrop(repo: Repo, header: HTMLElement): ProjectHeaderPaneDrop {
  const items: SplitViewItem[] = [{ kind: 'project', ...projectOverviewTargetFor(repo) }]
  const endDrag = beginSplitViewDrag()
  let ghost: ReturnType<typeof createSidebarDragPreview> | null = null
  const hideGhost = (): void => {
    ghost?.preview.remove()
    ghost = null
  }
  return {
    track: (x, y) => {
      if (!trackSplitViewDrop(x, y, items)) {
        hideGhost()
        return false
      }
      // The sidebar shows an insertion line for reorders; over a pane the header follows the pointer.
      if (!ghost && header.isConnected) {
        ghost = createSidebarDragPreview({
          sourceRow: header,
          pointerX: x,
          pointerY: y,
          draggedCount: 1
        })
        ghost.offsetX = 12
        ghost.offsetY = 12
      }
      if (ghost) {
        updateSidebarDragPreviewPosition({
          preview: ghost.preview,
          pointerX: x,
          pointerY: y,
          offsetX: ghost.offsetX,
          offsetY: ghost.offsetY
        })
      }
      return true
    },
    commit: (x, y) => commitSplitViewDrop(x, y, items),
    end: () => {
      hideGhost()
      endDrag()
    }
  }
}
