import { useEffect } from 'react'
import { useAppStore } from '@/store/index'
import { useLatestHandler } from '@/lib/use-latest-handler'
import {
  requestVirtualizedScrollAnchorRecord,
  supersedeVirtualizedScrollAnchorRestore
} from '@/hooks/requestVirtualizedScrollAnchorRecord'
import { getSidebarStickyInset } from '@/components/sidebar/sidebar-scroll-sections'
import {
  getRevealTargetBounds,
  getScrollTopToRevealBounds
} from '@/components/sidebar/worktree-list/navigation/worktree-sidebar-reveal'
import { isActiveLiveSession } from '../../../../../shared/live-sessions/live-session-status'
import { liveSessionMarksStore, useLiveSessionMarks } from '../live-session-marks-store'
import { liveSessionRegistryStore } from '../live-session-registry-store'
import { useLiveSessionLinks } from '../links/use-live-session-links'
import {
  matchesSidebarSessionFilters,
  sidebarSessionFilterStore
} from './sidebar-session-filter-store'
import { workspaceFinishedOpenKey } from './workspace-session-rows-model'

const SIDEBAR_LIST = '[data-worktree-sidebar]'
/** How long a row may take to mount once its project unfolds and its card scrolls in. */
const ROW_MOUNT_FRAMES = 90
const HIGHLIGHT_MS = 4000

/** How much of the list's top is covered: the pinned Projects header, and a project or machine header stuck under it. */
function coveredListTop(list: HTMLElement): number {
  const listTop = list.getBoundingClientRect().top
  let covered = getSidebarStickyInset(list)
  for (const header of list.querySelectorAll('[data-worktree-sticky-header-active]')) {
    covered = Math.max(covered, header.getBoundingClientRect().bottom - listTop)
  }
  return covered
}

/** Where the list has to scroll to show the whole row; null when it already does. */
function scrollTopShowingRow(list: HTMLElement, row: HTMLElement): number | null {
  const bounds = getRevealTargetBounds(list, row)
  return bounds && getScrollTopToRevealBounds(list, bounds, coveredListTop(list))
}

function isSessionRowInView(row: HTMLElement): boolean {
  const list = row.closest<HTMLElement>(SIDEBAR_LIST)
  return list !== null && scrollTopShowingRow(list, row) === null
}

/** Scroll a workspace's session row fully into the sidebar list, by no more than it takes. */
export function scrollSidebarSessionRowIntoView(row: HTMLElement): void {
  const list = row.closest<HTMLElement>(SIDEBAR_LIST)
  if (!list) {
    row.scrollIntoView?.({ block: 'nearest' })
    return
  }
  const scrollTop = scrollTopShowingRow(list, row)
  if (scrollTop === null) {
    return
  }
  const target = Math.max(0, scrollTop)
  // Why: the list restores its own scroll position after its rows change height, which would undo this one.
  supersedeVirtualizedScrollAnchorRestore(list, target)
  list.scrollTop = target
  requestVirtualizedScrollAnchorRecord(list)
}

/** Shows a session row asked for from elsewhere (a badge, a fresh launch, the palette) under its workspace. */
export function useWorkspaceSessionRowReveal(): void {
  const reveal = useLiveSessionMarks().reveal
  const { links } = useLiveSessionLinks()
  const linksAtRequest = useLatestHandler(() => links)

  useEffect(() => {
    // Read at the moment of the request: later session updates must not move the list again.
    const session = reveal
      ? liveSessionRegistryStore.getState().sessions.find((s) => s.id === reveal.sessionId)
      : undefined
    const worktreeId = session && linksAtRequest().get(session.id)?.worktreeId
    if (!session || !worktreeId) {
      return
    }
    if (!matchesSidebarSessionFilters(session, sidebarSessionFilterStore.getState())) {
      sidebarSessionFilterStore.clear()
    }
    const app = useAppStore.getState()
    const finishedKey = workspaceFinishedOpenKey(worktreeId)
    if (!isActiveLiveSession(session) && !app.collapsedGroups.has(finishedKey)) {
      app.toggleCollapsedGroup(finishedKey)
    }

    const selector = `${SIDEBAR_LIST} [data-workspace-session-rows="${CSS.escape(worktreeId)}"] [data-live-session-row="${CSS.escape(session.id)}"]`
    const mountedRows = (): HTMLElement[] =>
      Array.from(document.querySelectorAll<HTMLElement>(selector))
    // A row already listed stays where it is: only a folded project or a card scrolled out of the list is brought in.
    if (mountedRows().length === 0) {
      app.revealWorktreeInSidebar(worktreeId, { behavior: 'auto' })
    }
    let frame = 0
    let framesLeft = ROW_MOUNT_FRAMES
    const showRow = (): void => {
      const rows = mountedRows()
      // The card is still scrolling in while its reveal is pending, and would carry the row off again.
      const settled = useAppStore.getState().pendingRevealWorktree?.worktreeId !== worktreeId
      if (rows.length > 0 && settled) {
        // A pinned workspace lists its rows twice: the copy in view must not send the list to the other.
        scrollSidebarSessionRowIntoView(rows.find(isSessionRowInView) ?? rows[0])
      } else if (framesLeft > 0) {
        framesLeft -= 1
        frame = requestAnimationFrame(showRow)
      }
    }
    showRow()
    const fade = setTimeout(() => liveSessionMarksStore.highlight([]), HIGHLIGHT_MS)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(fade)
    }
  }, [reveal, linksAtRequest])
}
