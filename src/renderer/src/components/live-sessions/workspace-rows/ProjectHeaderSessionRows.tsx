import React from 'react'
import { getProjectGroupHeaderPaddingLeft } from '@/components/sidebar/worktree-list/rows/indentation'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { headerSessionGroup } from '../links/sidebar-session-groups'
import { useProjectHeaderSessions } from '../links/use-workspace-sessions'
import { sessionGroupFinishedOpenKey } from './session-fold-keys'
import { SESSION_GROUP_ATTRIBUTE } from './sidebar-session-row-dom'
import { useSessionRowList, WorkspaceSessionRowList } from './WorkspaceSessionRows'

type Props = {
  headerKey: string
  /** The project header's label, which its rows need not repeat. */
  project: string | null
  groupDepth: number
}

const ProjectHeaderSessionRowsBody = React.memo(function ProjectHeaderSessionRowsBody({
  headerKey,
  project,
  groupDepth,
  sessions
}: Props & { sessions: readonly LiveSession[] }): React.JSX.Element | null {
  const group = headerSessionGroup(headerKey)
  const list = useSessionRowList(sessions, sessionGroupFinishedOpenKey(group))
  const { view } = list
  if (view.running.length === 0 && view.finished.length === 0 && view.hidden.length === 0) {
    return null
  }
  return (
    <div
      {...{ [SESSION_GROUP_ATTRIBUTE]: group }}
      className="pr-2 pb-1"
      style={{ paddingLeft: getProjectGroupHeaderPaddingLeft(groupDepth) }}
    >
      <WorkspaceSessionRowList worktreeId={null} project={project} {...list} />
    </div>
  )
})

/** A project's sessions that none of its workspaces holds, as rows right under its header. */
export const ProjectHeaderSessionRows = React.memo(function ProjectHeaderSessionRows(
  props: Props
): React.JSX.Element | null {
  const sessions = useProjectHeaderSessions(props.headerKey)
  // Only a project with such sessions pays for the clock, the marks and the row state.
  return sessions.length > 0 ? (
    <ProjectHeaderSessionRowsBody {...props} sessions={sessions} />
  ) : null
})
