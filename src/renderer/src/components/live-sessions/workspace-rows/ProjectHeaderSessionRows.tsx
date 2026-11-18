import React, { useMemo } from 'react'
import { getProjectGroupHeaderPaddingLeft } from '@/components/sidebar/worktree-list/rows/indentation'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import type { SessionWorkspaceRef } from '../../../../../shared/sidebar-list/row-types'
import { useProjectHeaderSessions } from '../links/use-workspace-sessions'
import { useWorkspacesSessions } from '../links/use-workspaces-sessions'
import { headerSessionGroup, sessionGroupFinishedOpenKey } from './session-fold-keys'
import { SESSION_GROUP_ATTRIBUTE } from './sidebar-session-row-dom'
import { useSessionRowList, WorkspaceSessionRowList } from './WorkspaceSessionRows'

type Props = {
  headerKey: string
  /** The project the header names, which its rows need not repeat. */
  project: string | null
  groupDepth: number
  /** While workspaces are hidden: the ones under the header, whose sessions it lists too. */
  workspaces?: readonly SessionWorkspaceRef[]
  /** False on a later host's copy of the header, which leaves the header's own sessions to the first. */
  headerSessions?: false
}

const NONE: readonly LiveSession[] = []

const ProjectHeaderSessionRowsBody = React.memo(function ProjectHeaderSessionRowsBody({
  headerKey,
  project,
  groupDepth,
  sessions,
  inWorkspaces
}: Props & {
  sessions: readonly LiveSession[]
  inWorkspaces: ReadonlySet<string>
}): React.JSX.Element | null {
  const group = headerSessionGroup(headerKey)
  const list = useSessionRowList(sessions, sessionGroupFinishedOpenKey(group))
  const { view } = list
  if (view.running.length === 0 && view.finished.length === 0) {
    return null
  }
  return (
    <div
      {...{ [SESSION_GROUP_ATTRIBUTE]: group }}
      className="pr-2 pb-1"
      style={{ paddingLeft: getProjectGroupHeaderPaddingLeft(groupDepth) }}
    >
      <WorkspaceSessionRowList
        worktreeId={null}
        project={project}
        inWorkspaces={inWorkspaces}
        {...list}
      />
    </div>
  )
})

/**
 * The sessions right under a header: the ones no workspace holds, a project's own or the header
 * they brought, and while workspaces are hidden those of the workspaces under it too.
 */
export const ProjectHeaderSessionRows = React.memo(function ProjectHeaderSessionRows(
  props: Props
): React.JSX.Element | null {
  const own = useProjectHeaderSessions(props.headerKey)
  const headerSessions = props.headerSessions === false ? NONE : own
  const inWorkspaces = useWorkspacesSessions(props.workspaces)
  const sessions = useMemo(
    () => (inWorkspaces.length === 0 ? headerSessions : [...headerSessions, ...inWorkspaces]),
    [headerSessions, inWorkspaces]
  )
  const inWorkspaceIds = useMemo(
    () => new Set(inWorkspaces.map((session) => session.id)),
    [inWorkspaces]
  )
  // Only a header with such sessions pays for the clock, the marks and the row state.
  return sessions.length > 0 ? (
    <ProjectHeaderSessionRowsBody {...props} sessions={sessions} inWorkspaces={inWorkspaceIds} />
  ) : null
})
