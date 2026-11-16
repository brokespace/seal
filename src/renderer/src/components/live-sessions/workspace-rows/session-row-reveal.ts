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
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
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

/** Stops what hides a session's row: the filters, and for an ended one the line it sits behind. */
export function unhideSessionRow(session: LiveSession, finishedOpenKey: string): void {
  if (!matchesSidebarSessionFilters(session, sidebarSessionFilterStore.getState())) {
    sidebarSessionFilterStore.clear()
  }
  const app = useAppStore.getState()
  if (!isActiveLiveSession(session) && !app.collapsedGroups.has(finishedOpenKey)) {
    app.toggleCollapsedGroup(finishedOpenKey)
  }
}

/**
 * Runs `show` once for each session asked for from elsewhere (a badge, a fresh launch, the
 * palette), then fades the row's ring. `show` gets the workspace that lists the session and
 * returns how to stop, or null when the row is another list's.
 */
export function useSessionRowRevealRequest(
  show: (session: LiveSession, worktreeId: string | undefined) => (() => void) | null
): void {
  const reveal = useLiveSessionMarks().reveal
  const { links } = useLiveSessionLinks()
  // Read at the moment of the request: later session updates must not move the list again.
  const showAtRequest = useLatestHandler((sessionId: string) => {
    const session = liveSessionRegistryStore.getState().sessions.find((s) => s.id === sessionId)
    return session ? show(session, links.get(session.id)?.worktreeId) : null
  })
  useEffect(() => {
    const stop = reveal ? showAtRequest(reveal.sessionId) : null
    if (!stop) {
      return
    }
    const fade = setTimeout(() => liveSessionMarksStore.highlight([]), HIGHLIGHT_MS)
    return () => {
      stop()
      clearTimeout(fade)
    }
  }, [reveal, showAtRequest])
}

/** Shows a session row asked for from elsewhere under its workspace. */
export function useWorkspaceSessionRowReveal(): void {
  useSessionRowRevealRequest((session, worktreeId) => {
    if (!worktreeId) {
      return null
    }
    unhideSessionRow(session, workspaceFinishedOpenKey(worktreeId))
    const selector = `${SIDEBAR_LIST} [data-workspace-session-rows="${CSS.escape(worktreeId)}"] [data-live-session-row="${CSS.escape(session.id)}"]`
    const mountedRows = (): HTMLElement[] =>
      Array.from(document.querySelectorAll<HTMLElement>(selector))
    // A row already listed stays where it is: only a folded project or a card scrolled out of the list is brought in.
    if (mountedRows().length === 0) {
      useAppStore.getState().revealWorktreeInSidebar(worktreeId, { behavior: 'auto' })
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
    return () => cancelAnimationFrame(frame)
  })
}
