import { LOCAL_EXECUTION_HOST_ID, toSshExecutionHostId } from '../execution-host'
import type { LiveSession, LiveSessionStatus } from '../live-sessions/live-session-types'
import type { HomeSession, HomeSessionState } from './home-overview-types'

/** The fields Home reads; providers stay open so a client decoding newer agents still maps them. */
export type HomeLiveSessionInput = Pick<
  LiveSession,
  'id' | 'machine' | 'cwd' | 'project' | 'status' | 'statusDetail' | 'lastActivityAt' | 'startedAt'
> & {
  provider: string
  permission: { question: string } | null
}

function homeStateFromLive(status: LiveSessionStatus): HomeSessionState {
  switch (status) {
    case 'working':
      return 'working'
    case 'waiting-input':
      return 'waiting'
    case 'needs-permission':
      return 'permission'
    case 'errored':
      return 'errored'
    case 'done':
      return 'done'
  }
}

export function liveSessionMachineId(session: Pick<LiveSession, 'machine'>): string {
  return session.machine.kind === 'local'
    ? LOCAL_EXECUTION_HOST_ID
    : toSshExecutionHostId(session.machine.hostId)
}

/** `labels` carries the caller's localized title and agent name. */
export function homeSessionFromLive(
  session: HomeLiveSessionInput,
  labels: { title: string; agentLabel: string }
): HomeSession {
  const state = homeStateFromLive(session.status)
  const machineId = liveSessionMachineId(session)
  const project = session.project ?? session.cwd ?? session.machine.label
  const askSummary =
    session.permission?.question ??
    (state === 'waiting' || state === 'permission' ? session.statusDetail : null)
  return {
    id: session.id,
    state,
    unseen: false,
    machineId,
    machineLabel: session.machine.label,
    projectId: `${machineId}:${session.cwd ?? project}`,
    projectName: project,
    workspaceName: session.project ?? '',
    title: labels.title,
    agentType: session.provider,
    agentLabel: labels.agentLabel,
    startedAt: session.startedAt ?? session.lastActivityAt,
    stateChangedAt: session.lastActivityAt,
    finishedAt: state === 'done' ? session.lastActivityAt : null,
    ...(askSummary ? { askSummary } : {}),
    target: { kind: 'live-session', sessionId: session.id }
  }
}
