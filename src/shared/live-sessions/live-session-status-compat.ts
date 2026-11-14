// Clients built before `running-shell` and `your-turn` existed decode the status as a closed set
// and drop a session whose status they do not know, so a host answers them in the statuses they have.
import type { RuntimeCapability } from '../protocol-version'
import type {
  LiveSession,
  LiveSessionRegistryEvent,
  LiveSessionRegistrySnapshot,
  LiveSessionStatus
} from './live-session-types'

/** The client reads every status in `LIVE_SESSION_STATUSES` as of `running-shell` and `your-turn`. */
export const LIVE_SESSION_STATUS_V2_CLIENT_CAPABILITY = 'live-sessions.status.v2'

/** Absent capabilities are this host's own trusted callers, which share its build. */
export function clientReadsLiveSessionStatusV2(
  capabilities: readonly RuntimeCapability[] | undefined
): boolean {
  return (
    capabilities === undefined || capabilities.includes(LIVE_SESSION_STATUS_V2_CLIENT_CAPABILITY)
  )
}

export function legacyLiveSessionStatus(status: LiveSessionStatus): LiveSessionStatus {
  if (status === 'running-shell') {
    return 'working'
  }
  return status === 'your-turn' ? 'idle' : status
}

function legacySession(session: LiveSession): LiveSession {
  const status = legacyLiveSessionStatus(session.status)
  const statusSource =
    session.statusSource === 'process' || session.statusSource === 'classifier'
      ? 'transcript'
      : session.statusSource
  return status === session.status && statusSource === session.statusSource
    ? session
    : { ...session, status, statusSource }
}

export function liveSessionSnapshotForClient(
  snapshot: LiveSessionRegistrySnapshot,
  capabilities: readonly RuntimeCapability[] | undefined
): LiveSessionRegistrySnapshot {
  return clientReadsLiveSessionStatusV2(capabilities)
    ? snapshot
    : { ...snapshot, sessions: snapshot.sessions.map(legacySession) }
}

export function liveSessionEventForClient(
  event: LiveSessionRegistryEvent,
  capabilities: readonly RuntimeCapability[] | undefined
): LiveSessionRegistryEvent {
  if (clientReadsLiveSessionStatusV2(capabilities)) {
    return event
  }
  if (event.type === 'upsert') {
    return { ...event, session: legacySession(event.session) }
  }
  return event.type === 'snapshot'
    ? { ...event, snapshot: liveSessionSnapshotForClient(event.snapshot, capabilities) }
    : event
}
