// Push a notice about a session started outside Seal to this host's phones. Chats and panes are pushed by their own owners.
import { isPairedServerLiveSession } from '../../../../shared/live-sessions/live-session-paired-server'
import type { LiveSession } from '../../../../shared/live-sessions/live-session-types'
import { parseExecutionHostId } from '../../../../shared/execution-host'
import {
  LIVE_SESSION_NOTICE_AGENT_STATE,
  type LiveSessionNotification
} from '../../../live-sessions/live-session-notifier'
import type { MobileNotificationDispatchEvent } from './runtime-mobile-notification-controller'

type PhoneDispatch = { dispatchMobileNotification(event: MobileNotificationDispatchEvent): void }

type SessionRecords = {
  get(sessionId: string): Pick<LiveSession, 'machine' | 'workspace'> | null
}

/** The registry notifier's phone channel: takes each notice the settings let through. */
export function createExternalSessionPhonePush(
  runtime: PhoneDispatch,
  sessions: SessionRecords,
  now: () => number = Date.now
): (notification: LiveSessionNotification) => void {
  return ({ sessionId, kind, title, body, surface }) => {
    if (surface.kind !== 'external') {
      return
    }
    const session = sessions.get(sessionId)
    if (!session) {
      return
    }
    // A paired server never holds the push registrations of the phones this desktop relays to it,
    // so this desktop pushes its sessions, as it does the server's panes.
    const server = isPairedServerLiveSession(session)
      ? parseExecutionHostId(session.machine.executionHostId)
      : null
    runtime.dispatchMobileNotification({
      type: 'notification',
      emittedAt: now(),
      source: 'agent-task-complete',
      title,
      body,
      ...(session.workspace ? { worktreeId: session.workspace.worktreeId } : {}),
      ...(server?.kind === 'runtime' ? { executionHost: server.id } : {}),
      agentState: LIVE_SESSION_NOTICE_AGENT_STATE[kind],
      // Keyed per notice: a repeat collapses, a question right after its turn's end does not.
      attentionKey: `live-session:${sessionId}:${kind}`
    })
  }
}
