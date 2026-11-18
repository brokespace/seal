import React, { useCallback, useMemo } from 'react'
import { useAppStore } from '@/store/index'
import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'
import { useSessionMachineName } from '@/components/machines/model/use-local-machine-name'
import type { ExecutionHostId } from '../../../../../shared/execution-host'
import { topLiveSessionStatus } from '../../../../../shared/live-sessions/live-session-status'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { useLiveSessionClock } from '../live-session-clock'
import { useLiveSessionMarks } from '../live-session-marks-store'
import { liveSessionsCountLabel } from '../links/LiveSessionsBadge'
import { useWorkspaceSessions } from '../links/use-workspace-sessions'
import { liveSessionRowOpenMode } from '../menu/live-session-menu-effects'
import { openAgentSession } from '../open/open-agent-session'
import { LiveSessionRow, type LiveSessionRowProps } from '../row/LiveSessionRow'
import { useLiveSessionRowState } from '../row/use-live-session-row-state'
import { FoldChevron } from './FoldChevron'
import { pickSidebarSessionRow } from './session-row-picking'
import { WORKTREE_NATIVE_CONTEXT_MENU_ATTR } from '@/components/sidebar/workspace-actions/context-menu/worktree-context-menu-policy'
import {
  buildWorkspaceSessionRows,
  sessionRowKey,
  workspaceFinishedOpenKey,
  type WorkspaceSessionRowsView
} from './workspace-session-rows-model'

export type WorkspaceSessionRowState = Pick<
  LiveSessionRowProps,
  'workspaceName' | 'account' | 'unread' | 'current' | 'highlighted' | 'picked' | 'machine'
>

export type WorkspaceSessionRowListProps = {
  /** Null lists sessions no workspace holds. */
  worktreeId: string | null
  /** The project those are listed under, which a row in a folder of that name need not repeat. */
  project?: string | null
  /** Sessions of the hidden workspaces listed here: each row names its workspace, whatever the project's name. */
  inWorkspaces?: ReadonlySet<string>
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

// Why: a press on a row released on the card around it is, to the browser, a click on that card.
function keepPressFromCard(event: React.PointerEvent<HTMLElement>): void {
  event.stopPropagation()
  const rows = event.currentTarget
  const { pointerId, pointerType } = event
  // A press inside a row's menu comes here through React alone: the menu is drawn outside the rows.
  if (event.button !== 0 || !(event.target instanceof Node) || !rows.contains(event.target)) {
    return
  }
  const dropClickOnCard = (click: MouseEvent): void => {
    // The click lands on what holds both ends of the press; a menu item's or a key's click is not that.
    const around =
      click.target instanceof Node && click.target !== rows && click.target.contains(rows)
    if (around && click.detail > 0) {
      click.stopPropagation()
    }
  }
  const forget = (): void => {
    window.removeEventListener('click', dropClickOnCard, true)
    window.removeEventListener('dblclick', dropClickOnCard, true)
    window.removeEventListener('pointerup', onRelease, true)
    window.removeEventListener('pointercancel', onLost, true)
    window.removeEventListener('pointerdown', onLost, true)
  }
  // The click follows its release at once; a later one is not this press's.
  const onRelease = (release: PointerEvent): void => {
    if (release.pointerId === pointerId) {
      window.setTimeout(forget, 0)
    }
  }
  // A touch that turns into a scroll ends without a release; a new press means the release went unheard.
  const onLost = (pointer: PointerEvent): void => {
    if (pointer.pointerId === pointerId || pointer.pointerType === pointerType) {
      forget()
    }
  }
  window.addEventListener('click', dropClickOnCard, true)
  window.addEventListener('dblclick', dropClickOnCard, true)
  window.addEventListener('pointerup', onRelease, true)
  window.addEventListener('pointercancel', onLost, true)
  window.addEventListener('pointerdown', onLost, true)
}

/** One workspace's sessions on its card, or one project's that no workspace holds: a full row each, then the ended ones behind one line. */
export function WorkspaceSessionRowList(props: WorkspaceSessionRowListProps): React.JSX.Element {
  const t = useTranslate()
  const { view } = props
  const keys = new Set<string>()
  // Under its project's header a row names its workspace alone, not "project / workspace".
  const projectPrefix = props.project ? `${props.project} / `.toLowerCase() : null
  const row = (session: LiveSession): React.JSX.Element => {
    const shared = props.rowState(session)
    const state =
      projectPrefix && shared.workspaceName?.toLowerCase().startsWith(projectPrefix)
        ? { ...shared, workspaceName: shared.workspaceName.slice(projectPrefix.length) }
        : shared
    const shown = sessionRowKey(session)
    const key = keys.has(shown) ? session.id : shown
    keys.add(key)
    return (
      <LiveSessionRow
        key={key}
        session={session}
        // The card above the row names the workspace; a row no card holds names its place itself.
        showPlace={
          props.worktreeId === null &&
          (props.inWorkspaces?.has(session.id) === true ||
            (state.workspaceName ?? session.project)?.toLowerCase() !==
              props.project?.toLowerCase())
        }
        {...state}
        // Tab stops on the row of the session on screen, in its place; arrow keys reach the others from the list.
        tabStop={state.current}
        now={props.now}
        onOpen={props.onOpen}
        onPick={props.onPick}
        menu={props.menu}
      />
    )
  }
  // What the card's badge said before the rows replaced it: how many run and what the most urgent needs.
  const top = topLiveSessionStatus(view.running.map((session) => session.status))
  const groupLabel =
    top === null
      ? t('auto.components.live-sessions.sessionRows.label', 'Agent sessions')
      : liveSessionsCountLabel(t, view.running.length, top)
  return (
    <div
      role="group"
      data-workspace-session-rows={props.worktreeId ?? ''}
      // Why: the card takes a right-click in the capture phase; this leaves it to the row's own menu.
      {...{ [WORKTREE_NATIVE_CONTEXT_MENU_ATTR]: '' }}
      aria-label={groupLabel}
      className={cn('flex min-w-0 flex-col', props.className)}
      onClick={keepFromCard}
      onDoubleClick={keepFromCard}
      onPointerDown={keepPressFromCard}
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
            <FoldChevron open={props.finishedOpen} />
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
  openAgentSession(session, liveSessionRowOpenMode(event))
}

export type SessionRowList = Pick<
  WorkspaceSessionRowListProps,
  'view' | 'finishedOpen' | 'rowState' | 'now' | 'onToggleFinished' | 'onOpen' | 'onPick'
>

/** The rows one sidebar list shows and what they do, under a workspace or a project. */
export function useSessionRowList(
  sessions: readonly LiveSession[],
  finishedKey: string
): SessionRowList {
  const now = useLiveSessionClock()
  const sharedRowState = useLiveSessionRowState()
  const picked = useLiveSessionMarks().picked
  const machineName = useSessionMachineName()
  const finishedOpen = useAppStore((state) => state.collapsedGroups.has(finishedKey))
  const toggleCollapsedGroup = useAppStore((state) => state.toggleCollapsedGroup)
  const view = useMemo(() => buildWorkspaceSessionRows(sessions, now), [sessions, now])
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
        // Rows on this computer go without; the badge marks a session on another machine.
        machine: session.machine.kind === 'local' ? null : machineName(session.machine)
      }
    },
    [sharedRowState, picked, machineName]
  )
  const onToggleFinished = useCallback(
    () => toggleCollapsedGroup(finishedKey),
    [toggleCollapsedGroup, finishedKey]
  )
  return {
    view,
    finishedOpen,
    rowState,
    now,
    onToggleFinished,
    onOpen: openFromRow,
    onPick: pickSidebarSessionRow
  }
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
  const list = useSessionRowList(sessions, workspaceFinishedOpenKey(worktreeId))
  const { view } = list
  if (view.running.length === 0 && view.finished.length === 0) {
    return null
  }
  return <WorkspaceSessionRowList worktreeId={worktreeId} {...list} className={className} />
})

/** Every agent session of a workspace as rows on its card. A workspace without sessions adds nothing. */
export const WorkspaceSessionRows = React.memo(function WorkspaceSessionRows({
  worktreeId,
  hostId,
  className
}: {
  worktreeId: string
  /** The host whose card this is, where a workspace has one per host. */
  hostId?: ExecutionHostId
  className?: string
}): React.JSX.Element | null {
  const sessions = useWorkspaceSessions(worktreeId, hostId)
  // Only a card with sessions pays for the clock, the marks and the row state.
  return sessions.length > 0 ? (
    <WorkspaceSessionRowsBody worktreeId={worktreeId} sessions={sessions} className={className} />
  ) : null
})
