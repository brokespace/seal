import type { LiveSession } from './live-session-types'

function sameAgentAndHost(a: LiveSession, b: LiveSession): boolean {
  return a.provider === b.provider && a.machine.hostId === b.machine.hostId
}

/** The chat or the Seal pane a record stands for, whatever id the session goes by. */
function sameSurface(gone: LiveSession, session: LiveSession): boolean {
  if (gone.surface.kind === 'chat') {
    return session.surface.kind === 'chat' && session.surface.sessionId === gone.surface.sessionId
  }
  return (
    gone.surface.kind === 'cli' &&
    // Only an id Seal made up is replaced: a pane whose agent starts a new session shows a new one.
    gone.providerSessionId.startsWith('pane-') &&
    session.surface.kind === 'cli' &&
    session.surface.paneKey === gone.surface.paneKey
  )
}

/** The same process, chat or pane under the id its agent gave it since. */
export function isSessionRenamedTo(gone: LiveSession, session: LiveSession): boolean {
  return (
    session.id !== gone.id &&
    sameAgentAndHost(gone, session) &&
    ((gone.pid !== null && gone.providerSessionId.startsWith('pid-') && session.pid === gone.pid) ||
      sameSurface(gone, session))
  )
}

/**
 * The record a session that left the list lives on in: one that continues it (a resume into a new
 * transcript, a fork), or the same process, chat or pane under the id its agent gave it since.
 */
export function sessionSuccessor(
  gone: LiveSession,
  sessions: readonly LiveSession[]
): LiveSession | undefined {
  return (
    sessions.find((session) => session.continues?.includes(gone.id)) ??
    sessions.find((session) => isSessionRenamedTo(gone, session))
  )
}
