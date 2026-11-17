import type { Repo } from '../../../../../../shared/repo-types'
import { projectOverviewTargetFor } from '@/store/slices/ui/project-overview-target'
import {
  beginSplitViewPaneDrop,
  splitViewItemsLoad,
  type SplitViewPaneDrop
} from '../../../split-view/split-view-pane-drop'

/** A project-header drag's hand-off to split-view panes while the pointer is over the main area. */
export type ProjectHeaderPaneDrop = SplitViewPaneDrop

export function beginProjectHeaderPaneDrop(repo: Repo, header: HTMLElement): ProjectHeaderPaneDrop {
  // The sidebar shows an insertion line for reorders; over a pane the header follows the pointer.
  return beginSplitViewPaneDrop(
    splitViewItemsLoad([{ kind: 'project', ...projectOverviewTargetFor(repo) }]),
    header,
    'over-panes'
  )
}
