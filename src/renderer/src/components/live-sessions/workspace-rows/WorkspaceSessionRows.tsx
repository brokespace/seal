import React, { useCallback, useMemo } from 'react'
import { ChevronRight } from 'lucide-react'
import { useAppStore } from '@/store/index'
import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'
import { useSessionMachineName } from '@/components/machines/model/use-local-machine-name'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { useLiveSessionClock } from '../live-session-clock'
import { useLiveSessionMarks } from '../live-session-marks-store'
import { useWorkspaceSessions } from '../links/use-workspace-sessions'
import { liveSessionRowOpenMode } from '../menu/live-session-menu-effects'
import { openAgentSession } from '../open/open-agent-session'
import { LiveSessionRow, type LiveSessionRowProps } from '../row/LiveSessionRow'
import { useLiveSessionRowState } from '../row/use-live-session-row-state'
import { pickSidebarSessionRow } from './session-row-picking'
import { WORKTREE_NATIVE_CONTEXT_MENU_ATTR } from '@/components/sidebar/workspace-actions/context-menu/worktree-context-menu-policy'
import { useSidebarSessionFilters } from './sidebar-session-filter-store'
import {
  buildWorkspaceSessionRows,
  workspaceFinishedOpenKey,
  type WorkspaceSessionRowsView
} from './workspace-session-rows-model'

export type WorkspaceSessionRowState = Pick<
  LiveSessionRowProps,
  'workspaceName' | 'account' | 'unread' | 'current' | 'highlighted' | 'picked' | 'machine'
>

export type WorkspaceSessionRowListProps = {
  worktreeId: string
  view: WorkspaceSessionRowsView
  finishedOpen: boolean
  rowState: (session: LiveSession) => WorkspaceSessionRowState
  now: number
  onToggleFinished: () => void
  onOpen: LiveSessionRowProps['onOpen']
  onPick: LiveSessionRowProps['onPick']
  menu?: LiveSessionRowProps['menu']
  className?: string
}

// The card around the rows activates, drags and opens its own menu on these.
function keepFromCard(event: React.SyntheticEvent): void {
  event.stopPropagation()
}

function refuseCardDrag(event: React.DragEvent): void {
  event.preventDefault()
  event.stopPropagation()
}

/** One workspace's sessions on its card: a full row each, then the ended ones behind one line. */
export function WorkspaceSessionRowList(props: WorkspaceSessionRowListProps): React.JSX.Element {
  const t = useTranslate()
  const { view } = props
  const row = (session: LiveSession): React.JSX.Element => (
    <LiveSessionRow
      key={session.id}
      session={session}
      // The card above the row names the workspace; the hover preview still does.
      showPlace={false}
      {...props.rowState(session)}
      // The sidebar list is the one Tab stop; arrow keys reach the rows from it.
      tabStop={false}
      now={props.now}
      onOpen={props.onOpen}
      onPick={props.onPick}
      menu={props.menu}
    />
  )
  return (
    <div
      role="group"
      data-workspace-session-rows={props.worktreeId}
      // Why: the card takes a right-click in the capture phase; this leaves it to the row's own menu.
      {...{ [WORKTREE_NATIVE_CONTEXT_MENU_ATTR]: '' }}
      aria-label={t('auto.components.live-sessions.sessionRows.label', 'Agent sessions')}
      className={cn('flex min-w-0 flex-col', props.className)}
      onClick={keepFromCard}
      onDoubleClick={keepFromCard}
      onPointerDown={keepFromCard}
      onMouseDown={keepFromCard}
      onContextMenu={keepFromCard}
      onDragStart={refuseCardDrag}
    >
      {view.running.map(row)}
      {view.finished.length > 0 ? (
        <>
          <button
            type="button"
            tabIndex={-1}
            data-workspace-sessions-finished-toggle
            aria-expanded={props.finishedOpen}
            onClick={props.onToggleFinished}
            className="flex h-5 min-w-0 items-center gap-1 rounded-md px-1.5 text-left text-2xs leading-none text-muted-foreground transition-colors hover:bg-worktree-sidebar-accent hover:text-worktree-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-worktree-sidebar-ring focus-visible:outline-none focus-visible:ring-inset"
          >
            <ChevronRight
              className={cn(
                'size-3 shrink-0 transition-transform',
                props.finishedOpen && 'rotate-90'
              )}
              aria-hidden="true"
            />
            <span className="min-w-0 truncate">
              {t(
                'auto.components.live-sessions.sessionRows.finished',
                'Recently finished · {{count}}',
                { count: view.finished.length }
              )}
            </span>
          </button>
          {props.finishedOpen ? view.finished.map(row) : null}
        </>
      ) : null}
    </div>
  )
}

function openFromRow(session: LiveSession, event: { type: string }): void {
  openAgentSession(session.id, liveSessionRowOpenMode(event))
}

const WorkspaceSessionRowsBody = React.memo(function WorkspaceSessionRowsBody({
  worktreeId,
  sessions,
  className
}: {
  worktreeId: string
  sessions: readonly LiveSession[]
  className?: string
}): React.JSX.Element | null {
  const filters = useSidebarSessionFilters()
  const now = useLiveSessionClock()
  const sharedRowState = useLiveSessionRowState()
  const picked = useLiveSessionMarks().picked
  const machineName = useSessionMachineName()
  const finishedKey = workspaceFinishedOpenKey(worktreeId)
  const finishedOpen = useAppStore((state) => state.collapsedGroups.has(finishedKey))
  const toggleCollapsedGroup = useAppStore((state) => state.toggleCollapsedGroup)
  const view = useMemo(
    () => buildWorkspaceSessionRows(sessions, filters, now),
    [sessions, filters, now]
  )
  const rowState = useCallback(
    (session: LiveSession): WorkspaceSessionRowState => {
      const { workspaceName, account, unread, current, highlighted } = sharedRowState(session)
      return {
        workspaceName,
        account,
        unread,
        current,
        highlighted,
        picked: picked ? picked.has(session.id) : null,
        // The card names its own machine; a row says so only when it runs somewhere else.
        machine: session.machine.kind === 'local' ? null : machineName(session.machine)
      }
    },
    [sharedRowState, picked, machineName]
  )
  const onToggleFinished = useCallback(
    () => toggleCollapsedGroup(finishedKey),
    [toggleCollapsedGroup, finishedKey]
  )
  if (view.running.length === 0 && view.finished.length === 0) {
    return null
  }
  return (
    <WorkspaceSessionRowList
      worktreeId={worktreeId}
      view={view}
      finishedOpen={finishedOpen}
      rowState={rowState}
      now={now}
      onToggleFinished={onToggleFinished}
      onOpen={openFromRow}
      onPick={pickSidebarSessionRow}
      className={className}
    />
  )
})

/** Every agent session of a workspace as rows on its card. A workspace without sessions adds nothing. */
export const WorkspaceSessionRows = React.memo(function WorkspaceSessionRows({
  worktreeId,
  className
}: {
  worktreeId: string
  className?: string
}): React.JSX.Element | null {
  const sessions = useWorkspaceSessions(worktreeId)
  // Only a card with sessions pays for the clock, the marks and the row state.
  return sessions.length > 0 ? (
    <WorkspaceSessionRowsBody worktreeId={worktreeId} sessions={sessions} className={className} />
  ) : null
})
