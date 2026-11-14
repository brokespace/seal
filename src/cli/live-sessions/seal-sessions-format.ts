import { isActiveLiveSession } from '../../shared/live-sessions/live-session-status'
import { groupLiveSessionsByMachine } from '../../shared/live-sessions/live-session-summary'
import type {
  LiveSession,
  LiveSessionRegistrySnapshot
} from '../../shared/live-sessions/live-session-types'

function sessionLine(session: LiveSession): string {
  const title = session.customTitle ?? session.title ?? session.project ?? 'New session'
  const detail = session.permission?.question ?? session.statusDetail
  return [
    `  ${session.status.padEnd(16)}`,
    session.provider.padEnd(6),
    title,
    session.project && session.project !== title ? `(${session.project})` : null,
    detail ? `— ${detail}` : null,
    `[${session.id}]`
  ]
    .filter(Boolean)
    .join(' ')
}

/** Machines, this one first, each with its sessions in the order Active agents lists them. */
export function formatLiveSessions(
  snapshot: Pick<LiveSessionRegistrySnapshot, 'sessions'>,
  includeEnded: boolean
): string {
  const listed = snapshot.sessions.filter((session) => includeEnded || isActiveLiveSession(session))
  if (listed.length === 0) {
    return includeEnded ? 'No agent sessions.' : 'No running agent sessions.'
  }
  return groupLiveSessionsByMachine(listed)
    .map((machine) =>
      [
        machine.label,
        // Ended sessions stay under their machine, after its running ones.
        ...machine.sessions.filter(isActiveLiveSession),
        ...machine.sessions.filter((session) => !isActiveLiveSession(session))
      ]
        .map((entry) => (typeof entry === 'string' ? entry : sessionLine(entry)))
        .join('\n')
    )
    .join('\n\n')
}
