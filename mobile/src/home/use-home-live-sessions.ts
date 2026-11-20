import { useMemo } from 'react'
import { liveSessionsNeedingAttention } from '../../../src/shared/live-sessions/live-session-summary'
import {
  compareLiveSessions,
  isActiveLiveSession,
  liveSessionStatusGroup
} from '../../../src/shared/live-sessions/live-session-status'
import { useLiveSessionsFeedStates } from '../seal/live-sessions/live-sessions-feed'
import {
  pairedDesktopSessions,
  type DesktopLiveSession,
  type PairedDesktopSessions
} from '../seal/live-sessions/paired-desktop-sessions'
import type { RpcClient } from '../transport/rpc/rpc-client-contract'

export type HomeLiveSessions = PairedDesktopSessions & {
  /** Waiting on the person, most urgent first: the Agents tab's badge. */
  needsYou: readonly DesktopLiveSession[]
  /** Those, then the sessions working now: Feed's Active list. */
  active: readonly DesktopLiveSession[]
  needsYouByHost: Readonly<Record<string, number>>
}

/** Every paired desktop's live sessions, as the Agents tab lists them, for Home's counts and Feed. */
export function useHomeLiveSessions(
  hosts: readonly { hostId: string; client: RpcClient | null }[]
): HomeLiveSessions {
  const clients = useMemo(() => hosts.map((host) => host.client), [hosts])
  const states = useLiveSessionsFeedStates(clients)
  return useMemo(() => {
    const paired = pairedDesktopSessions(
      hosts.map((host, at) => ({ hostId: host.hostId, sessions: states[at]?.sessions ?? [] }))
    )
    const needsYou = liveSessionsNeedingAttention(paired.all)
    const working = paired.all
      .filter(
        (session) =>
          isActiveLiveSession(session) && liveSessionStatusGroup(session.status) === 'working'
      )
      .sort(compareLiveSessions)
    const needsYouByHost: Record<string, number> = {}
    for (const session of needsYou) {
      needsYouByHost[session.desktopHostId] = (needsYouByHost[session.desktopHostId] ?? 0) + 1
    }
    return { ...paired, needsYou, active: [...needsYou, ...working], needsYouByHost }
  }, [hosts, states])
}
