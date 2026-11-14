import { liveSessionMachineId as machineIdOfLiveSession } from '../live-sessions/live-session-machine-id'
import type { LiveSession, LiveSessionStatus } from '../live-sessions/live-session-types'
import type { HomeSession, HomeSessionState } from './home-overview-types'

/** The fields Home reads; providers stay open so a client decoding newer agents still maps them. */
export type HomeLiveSessionInput = Omit<HomeLiveSessionFields, 'machine'> & {
  machine: Parameters<typeof machineIdOfLiveSession>[0] & { label: string }
}

type HomeLiveSessionFields = Pick<
  LiveSession,
  | 'id'
  | 'machine'
  | 'cwd'
  | 'project'
  | 'status'
  | 'statusDetail'
  | 'lastActivityAt'
  | 'startedAt'
  | 'alive'
> & {
  provider: string
  permission: { question: string } | null
}

function homeStateFromLive(status: LiveSessionStatus, alive: boolean): HomeSessionState {
  switch (status) {
    case 'working':
    case 'waiting-subagent':
    case 'waiting-task':
      // Waiting on its own subagents or background commands is work in progress, not a wait on the user.
      return alive ? 'working' : 'done'
    case 'idle':
      return alive ? 'idle' : 'done'
    case 'waiting-input':
      return alive ? 'waiting' : 'done'
    case 'needs-permission':
      return alive ? 'permission' : 'done'
    case 'errored':
      return 'errored'
    case 'done':
      return 'done'
  }
}

export function liveSessionMachineId(session: Pick<HomeLiveSessionInput, 'machine'>): string {
  return machineIdOfLiveSession(session.machine)
}

/** `labels` carries the caller's localized title and agent name. */
export function homeSessionFromLive(
  session: HomeLiveSessionInput,
  labels: { title: string; agentLabel: string }
): HomeSession {
  const state = homeStateFromLive(session.status, session.alive)
  const machineId = liveSessionMachineId(session)
  const project = session.project ?? session.cwd ?? session.machine.label
  const askSummary =
    session.permission?.question ??
    (state === 'waiting' || state === 'permission' ? session.statusDetail : null)
  return {
    id: session.id,
    state,
    // The registry keeps no read state: an agent still running after an error has not been dealt with.
    unseen: state === 'errored' && session.alive,
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
    ...(state === 'errored' && session.statusDetail ? { errorSummary: session.statusDetail } : {}),
    target: { kind: 'live-session', sessionId: session.id }
  }
}
