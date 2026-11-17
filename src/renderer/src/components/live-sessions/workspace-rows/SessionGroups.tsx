import React, { useRef } from 'react'
import { ChevronDown, FolderTree } from 'lucide-react'
import { useAppStore } from '@/store/index'
import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'
import {
  SIDEBAR_KEYBOARD_SECTION_PROPS,
  useSidebarSectionKeyboardEntry
} from '@/components/sidebar/sidebar-section-keyboard-handoff'
import { topLiveSessionStatus } from '../../../../../shared/live-sessions/live-session-status'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { useLiveSessionMarks } from '../live-session-marks-store'
import { looseSessionGroup } from '../links/sidebar-session-groups'
import { useSidebarSessionGroups } from '../links/use-workspace-sessions'
import type { LiveSessionRowProps } from '../row/LiveSessionRow'
import { LiveSessionStatusDot } from '../status/LiveSessionStatusDot'
import { FoldChevron } from './FoldChevron'
import {
  sessionGroupCollapseKey,
  sessionGroupFinishedOpenKey,
  UNASSIGNED_SESSION_GROUP
} from './session-fold-keys'
import { enterSessionGroup } from './session-row-keyboard'
import { SESSION_GROUP_ATTRIBUTE, SESSION_GROUP_TOGGLE_PROPS } from './sidebar-session-row-dom'
import {
  useSessionRowList,
  WorkspaceSessionRowList,
  type SessionRowList
} from './WorkspaceSessionRows'

export type SessionGroupViewProps = {
  group: string
  /** The project the sessions belong to; null for the ones with no folder to name one by. */
  project: string | null
  list: SessionRowList
  open: boolean
  onToggle: () => void
  /** Sessions are being picked for a bulk action. */
  selecting: boolean
  menu?: LiveSessionRowProps['menu']
  ref?: React.Ref<HTMLElement>
}

/** The group's label, which folds it, then the rows a workspace card would list. */
export function SessionGroupView({
  group,
  project,
  list,
  open,
  onToggle,
  selecting,
  menu,
  ref
}: SessionGroupViewProps): React.JSX.Element {
  const t = useTranslate()
  const title = project ?? t('seal.sessionTab.unassigned', 'Unassigned')
  const { running } = list.view
  const top = topLiveSessionStatus(running.map((session) => session.status))
  return (
    <section
      ref={ref}
      {...{ [SESSION_GROUP_ATTRIBUTE]: group }}
      {...SIDEBAR_KEYBOARD_SECTION_PROPS}
      aria-label={title}
      className="flex min-w-0 flex-col px-2 py-1"
    >
      <button
        type="button"
        {...SESSION_GROUP_TOGGLE_PROPS}
        aria-expanded={open}
        onClick={onToggle}
        className={cn(
          'flex w-full min-w-0 items-center gap-1.5 rounded-md text-left leading-none transition-colors hover:bg-worktree-sidebar-accent hover:text-worktree-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-worktree-sidebar-ring focus-visible:outline-none focus-visible:ring-inset',
          // A project here reads as the project headers above it do.
          project === null ? 'h-6 px-1.5 text-2xs text-muted-foreground' : 'h-7 px-0.5'
        )}
      >
        {project === null ? (
          <FoldChevron open={open} />
        ) : (
          <span className="flex size-4 shrink-0 items-center justify-center">
            <FolderTree className="size-3" />
          </span>
        )}
        <span
          className={cn(
            'min-w-0 flex-1 truncate',
            project === null ? 'font-medium' : 'text-[13px] leading-4 font-semibold'
          )}
        >
          {title}
        </span>
        {/* Folded, the group still says what its most urgent session needs. */}
        {!open && top ? <LiveSessionStatusDot status={top} /> : null}
        {running.length > 0 ? (
          <span className="shrink-0 text-2xs text-muted-foreground tabular-nums">
            {running.length}
          </span>
        ) : null}
        {project === null ? null : (
          <ChevronDown
            aria-hidden="true"
            className={cn(
              'size-3.5 shrink-0 text-muted-foreground transition-transform',
              !open && '-rotate-90'
            )}
          />
        )}
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
          <WorkspaceSessionRowList worktreeId={null} project={project} {...list} menu={menu} />
        </div>
      ) : null}
    </section>
  )
}

const SessionGroupBody = React.memo(function SessionGroupBody({
  group,
  project,
  sessions
}: {
  group: string
  project: string | null
  sessions: readonly LiveSession[]
}): React.JSX.Element | null {
  const section = useRef<HTMLElement>(null)
  const list = useSessionRowList(sessions, sessionGroupFinishedOpenKey(group))
  const selecting = useLiveSessionMarks().picked !== null
  const collapseKey = sessionGroupCollapseKey(group)
  const open = useAppStore((state) => !state.collapsedGroups.has(collapseKey))
  const toggleCollapsedGroup = useAppStore((state) => state.toggleCollapsedGroup)
  // Arrow keys run through the whole sidebar list: the workspaces hand the cursor on to this group.
  useSidebarSectionKeyboardEntry(
    () => section.current,
    (edge) => enterSessionGroup(section.current, edge)
  )
  // Sessions the filters leave out are not listed: the toolbar says when nothing matches at all.
  if (list.view.running.length === 0 && list.view.finished.length === 0) {
    return null
  }
  return (
    <SessionGroupView
      ref={section}
      group={group}
      project={project}
      list={list}
      open={open}
      onToggle={() => toggleCollapsedGroup(collapseKey)}
      selecting={selecting}
    />
  )
})

/**
 * After the last workspace: each project the list has no header for, with the sessions its name
 * gives it, then the sessions with no folder to name a project by. Absent while there are none.
 */
export const SessionGroups = React.memo(function SessionGroups() {
  const { loose, unassigned } = useSidebarSessionGroups()
  return (
    <>
      {loose.map((project) => (
        <SessionGroupBody
          key={project.key}
          group={looseSessionGroup(project.key)}
          project={project.name}
          sessions={project.sessions}
        />
      ))}
      {/* Only a group with sessions pays for the clock, the marks and the row state. */}
      {unassigned.length > 0 ? (
        <SessionGroupBody group={UNASSIGNED_SESSION_GROUP} project={null} sessions={unassigned} />
      ) : null}
    </>
  )
})
