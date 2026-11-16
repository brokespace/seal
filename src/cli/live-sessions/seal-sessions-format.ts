import { agentSessionAdapter } from '../../shared/live-sessions/adapters/agent-session-adapters'
import { liveSessionMachineId } from '../../shared/live-sessions/live-session-machine-id'
import { isActiveLiveSession } from '../../shared/live-sessions/live-session-status'
import type {
  LiveSession,
  LiveSessionRegistrySnapshot
} from '../../shared/live-sessions/live-session-types'
import {
  groupLiveSessionsByWorkspace,
  isLiveSessionPlaceInProject,
  liveSessionPlaceOf
} from '../../shared/live-sessions/live-session-workspace-groups'
import { liveSessionLabel } from '../../shared/session-recap/live-session-label'

type LiveSessionListFilter = { machine?: string; project?: string }

function isOnMachine(machine: LiveSession['machine'], query: string): boolean {
  return (
    machine.hostId === query ||
    liveSessionMachineId(machine) === query ||
    machine.label.toLowerCase() === query.toLowerCase()
  )
}

/** The snapshot narrowed to `--machine` and `--project`: what the table lists and `--json` prints. */
export function filterLiveSessionSnapshot<T extends Pick<LiveSessionRegistrySnapshot, 'sessions'>>(
  snapshot: T,
  { machine, project }: LiveSessionListFilter
): T {
  if (machine === undefined && project === undefined) {
    return snapshot
  }
  return {
    ...snapshot,
    sessions: snapshot.sessions.filter(
      (session) =>
        (machine === undefined || isOnMachine(session.machine, machine)) &&
        (project === undefined || isLiveSessionPlaceInProject(liveSessionPlaceOf(session), project))
    )
  }
}

const HEADINGS = ['STATUS', 'AGENT', 'PROJECT', 'WORKSPACE', 'MACHINE', 'SESSION']

function sessionCells(
  session: LiveSession,
  project: string | null,
  workspace: string | null
): string[] {
  const detail = session.permission?.question ?? session.statusDetail
  return [
    session.status,
    agentSessionAdapter(session.provider)?.label ?? session.provider,
    project ?? '-',
    workspace ?? '-',
    session.machine.label,
    [liveSessionLabel(session) ?? 'New session', detail ? `— ${detail}` : null, `[${session.id}]`]
      .filter(Boolean)
      .join(' ')
  ]
}

/** One row per session, by project and then workspace, each workspace's sessions in listed order. */
export function formatLiveSessions(
  snapshot: Pick<LiveSessionRegistrySnapshot, 'sessions'>,
  includeEnded: boolean
): string {
  const listed = snapshot.sessions.filter((session) => includeEnded || isActiveLiveSession(session))
  if (listed.length === 0) {
    return includeEnded ? 'No agent sessions.' : 'No running agent sessions.'
  }
  const rows = groupLiveSessionsByWorkspace(listed).flatMap((project) =>
    project.workspaces.flatMap((workspace) =>
      [
        // Ended sessions stay under their workspace, after its running ones.
        ...workspace.sessions.filter(isActiveLiveSession),
        ...workspace.sessions.filter((session) => !isActiveLiveSession(session))
      ].map((session) => sessionCells(session, project.label, workspace.label))
    )
  )
  const widths = HEADINGS.map((heading, column) =>
    Math.max(heading.length, ...rows.map((row) => row[column].length))
  )
  return [HEADINGS, ...rows]
    .map((row) =>
      row
        .map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd(widths[column])))
        .join('  ')
    )
    .join('\n')
}
