import React, { useRef } from 'react'
import { useAppStore } from '@/store/index'
import { useTranslate } from '@/i18n/use-translate'
import {
  SIDEBAR_KEYBOARD_SECTION_PROPS,
  useSidebarSectionKeyboardEntry
} from '@/components/sidebar/sidebar-section-keyboard-handoff'
import { topLiveSessionStatus } from '../../../../../shared/live-sessions/live-session-status'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { useLiveSessionMarks } from '../live-session-marks-store'
import { useUnassignedSessions } from '../links/use-workspace-sessions'
import type { LiveSessionRowProps } from '../row/LiveSessionRow'
import { LiveSessionStatusDot } from '../status/LiveSessionStatusDot'
import { FoldChevron } from './FoldChevron'
import { UNASSIGNED_FINISHED_OPEN_KEY, UNASSIGNED_SESSIONS_COLLAPSE_KEY } from './session-fold-keys'
import { enterUnassignedSessions } from './session-row-keyboard'
import {
  UNASSIGNED_SESSIONS_PROPS,
  UNASSIGNED_SESSIONS_TOGGLE_PROPS
} from './sidebar-session-row-dom'
import {
  useSessionRowList,
  WorkspaceSessionRowList,
  type SessionRowList
} from './WorkspaceSessionRows'

export type UnassignedSessionRowsViewProps = {
  list: SessionRowList
  open: boolean
  onToggle: () => void
  /** Sessions are being picked for a bulk action. */
  selecting: boolean
  menu?: LiveSessionRowProps['menu']
  ref?: React.Ref<HTMLElement>
}

/** The group's label, which folds it, then the rows a workspace card would list. */
export function UnassignedSessionRowsView({
  list,
  open,
  onToggle,
  selecting,
  menu,
  ref
}: UnassignedSessionRowsViewProps): React.JSX.Element {
  const t = useTranslate()
  const title = t('seal.sessionTab.unassigned', 'Unassigned')
  const { running } = list.view
  const top = topLiveSessionStatus(running.map((session) => session.status))
  return (
    <section
      ref={ref}
      {...UNASSIGNED_SESSIONS_PROPS}
      {...SIDEBAR_KEYBOARD_SECTION_PROPS}
      aria-label={title}
      className="flex min-w-0 flex-col px-2 py-1"
    >
      <button
        type="button"
        {...UNASSIGNED_SESSIONS_TOGGLE_PROPS}
        aria-expanded={open}
        onClick={onToggle}
        className="flex h-6 w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left text-2xs leading-none text-muted-foreground transition-colors hover:bg-worktree-sidebar-accent hover:text-worktree-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-worktree-sidebar-ring focus-visible:outline-none focus-visible:ring-inset"
      >
        <FoldChevron open={open} />
        <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
        {/* Folded, the group still says what its most urgent session needs. */}
        {!open && top ? <LiveSessionStatusDot status={top} /> : null}
        {running.length > 0 ? (
          <span className="shrink-0 tabular-nums">{running.length}</span>
        ) : null}
      </button>
      {open ? (
        <div
          role="listbox"
          // Sidebar chrome, not a popup: Escape and arrow keys stay with the page beside it.
          data-focus-behavior="page"
          aria-multiselectable={selecting}
          aria-label={title}
          className="flex min-w-0 flex-col pl-2"
        >
          <WorkspaceSessionRowList worktreeId={null} {...list} menu={menu} />
        </div>
      ) : null}
    </section>
  )
}

const UnassignedSessionRowsBody = React.memo(function UnassignedSessionRowsBody({
  sessions
}: {
  sessions: readonly LiveSession[]
}): React.JSX.Element | null {
  const group = useRef<HTMLElement>(null)
  const list = useSessionRowList(sessions, UNASSIGNED_FINISHED_OPEN_KEY)
  const selecting = useLiveSessionMarks().picked !== null
  const open = useAppStore((state) => !state.collapsedGroups.has(UNASSIGNED_SESSIONS_COLLAPSE_KEY))
  const toggleCollapsedGroup = useAppStore((state) => state.toggleCollapsedGroup)
  // Arrow keys run through the whole sidebar list: the workspaces hand the cursor on to this group.
  useSidebarSectionKeyboardEntry(
    () => group.current,
    (edge) => enterUnassignedSessions(group.current, edge)
  )
  // Sessions the filters leave out are not listed: the toolbar says when nothing matches at all.
  if (list.view.running.length === 0 && list.view.finished.length === 0) {
    return null
  }
  return (
    <UnassignedSessionRowsView
      ref={group}
      list={list}
      open={open}
      onToggle={() => toggleCollapsedGroup(UNASSIGNED_SESSIONS_COLLAPSE_KEY)}
      selecting={selecting}
    />
  )
})

/** The sessions no workspace holds, as the sidebar list's last group. Absent while there are none. */
export const UnassignedSessionRows = React.memo(function UnassignedSessionRows() {
  const sessions = useUnassignedSessions()
  // Only a group with sessions pays for the clock, the marks and the row state.
  return sessions.length > 0 ? <UnassignedSessionRowsBody sessions={sessions} /> : null
})
