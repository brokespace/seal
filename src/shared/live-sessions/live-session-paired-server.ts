import type { LiveSession } from './live-session-types'

/**
 * The record is a paired Seal server's own. Its pane key, tab id and chat session id name a pane,
 * a tab and a chat in that server's Seal: look them up there, never among this Seal's own.
 */
export function isPairedServerLiveSession(session: Pick<LiveSession, 'machine'>): boolean {
  return session.machine.connection === 'server'
}

/** The chat this Seal's own host holds for a record; null for any other session, a server's chat included. */
export function localChatSessionId(
  session: Pick<LiveSession, 'machine' | 'surface'> | null
): string | null {
  return session?.surface.kind === 'chat' && !isPairedServerLiveSession(session)
    ? session.surface.sessionId
    : null
}
