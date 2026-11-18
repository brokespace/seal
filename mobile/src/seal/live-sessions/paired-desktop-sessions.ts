import { isPairedServerLiveSession } from '../../../../src/shared/live-sessions/live-session-paired-server'
import type { LiveSession } from './live-session-schemas'

/** A session as one paired desktop lists it. */
export type DesktopLiveSession = LiveSession & { desktopHostId: string }

export type PairedDesktopSessions = {
  /** Each desktop's sessions, without the copies another paired desktop owns. */
  byDesktop: ReadonlyMap<string, readonly LiveSession[]>
  all: readonly DesktopLiveSession[]
}

const sessionKey = (session: LiveSession) => `${session.provider}\0${session.providerSessionId}`

/**
 * Every paired desktop's sessions, each listed once. A desktop relays its paired servers' sessions,
 * so a server the phone also pairs with directly would show twice; the server's own record wins.
 */
export function pairedDesktopSessions(
  desktops: readonly { hostId: string; sessions: readonly LiveSession[] }[]
): PairedDesktopSessions {
  const owned = new Set<string>()
  for (const desktop of desktops) {
    for (const session of desktop.sessions) {
      if (!isPairedServerLiveSession(session)) {
        owned.add(sessionKey(session))
      }
    }
  }
  const byDesktop = new Map<string, readonly LiveSession[]>()
  const all: DesktopLiveSession[] = []
  for (const { hostId, sessions } of desktops) {
    const listed = sessions.filter(
      (session) => !isPairedServerLiveSession(session) || !owned.has(sessionKey(session))
    )
    byDesktop.set(hostId, listed)
    all.push(...listed.map((session) => ({ ...session, desktopHostId: hostId })))
  }
  return { byDesktop, all }
}
