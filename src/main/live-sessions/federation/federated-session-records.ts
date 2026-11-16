// A paired server's records as the desktop lists them: under the desktop's ids and its record of the server.
import type {
  AgentSessionSurface,
  LiveMessage,
  LiveSession,
  LiveSessionMachine
} from '../../../shared/live-sessions/live-session-types'
import { sessionCapabilities } from '../adapters/session-capabilities'
import { LOCAL_HOST_ID } from '../hosts/live-session-hosts'
import type { ServerSession } from './federated-watch-frames'

const SERVER_PREFIX = `${LOCAL_HOST_ID}:`

/** A server lists its own machine as `local`; what it lists from other machines is not federated. */
export function isServersOwnSession(session: ServerSession): boolean {
  return session.machine.hostId === LOCAL_HOST_ID && session.id.startsWith(SERVER_PREFIX)
}

/** The desktop's id for a session of the server's own machine, the same id the `hostRun` scan gives it. */
export function desktopSessionId(hostId: string, serverSessionId: string): string | null {
  return serverSessionId.startsWith(SERVER_PREFIX)
    ? `${hostId}:${serverSessionId.slice(SERVER_PREFIX.length)}`
    : null
}

/** The id the server knows a desktop session by, or null when it is not on that machine. */
export function serverSessionId(hostId: string, sessionId: string): string | null {
  const prefix = `${hostId}:`
  return sessionId.startsWith(prefix) ? SERVER_PREFIX + sessionId.slice(prefix.length) : null
}

/** A server from before `surface`: a Seal pane is a CLI session, anything else was started outside Seal. */
function surfaceOf(session: ServerSession): AgentSessionSurface {
  if (session.surface) {
    return session.surface
  }
  const pane =
    session.origin === 'seal'
      ? session.inputRoutes.find((route) => route.kind === 'seal-pane')
      : undefined
  return pane?.kind === 'seal-pane' ? { kind: 'cli', paneKey: pane.paneKey } : { kind: 'external' }
}

/**
 * The server's record under the desktop's machine record, or null for one that is not of the
 * server's own machine. Its input routes stay the server's: the desktop forwards, it never tries them.
 * `formerIds` are desktop ids the server said this session replaced.
 */
export function federatedSession(
  session: ServerSession,
  machine: LiveSessionMachine,
  formerIds: readonly string[] = []
): LiveSession | null {
  const id = isServersOwnSession(session) ? desktopSessionId(machine.hostId, session.id) : null
  if (id === null) {
    return null
  }
  const continues = [
    ...new Set([
      ...(session.continues ?? []).flatMap(
        (former) => desktopSessionId(machine.hostId, former) ?? []
      ),
      ...formerIds
    ])
  ]
  const { continues: _serverContinues, ...kept } = session
  const listed = {
    ...kept,
    id,
    machine,
    surface: surfaceOf(session),
    ...(continues.length > 0 ? { continues } : {})
  }
  return { ...listed, capabilities: session.capabilities ?? sessionCapabilities(listed) }
}

/** A server's message under the desktop's session id, or null for one to a session that is not federated. */
export function federatedMessage(message: LiveMessage, hostId: string): LiveMessage | null {
  const sessionId = desktopSessionId(hostId, message.sessionId)
  return sessionId === null ? null : { ...message, sessionId }
}
