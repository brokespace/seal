import {
  compareLiveSessions,
  isActiveLiveSession,
  liveSessionStatusGroup,
  type LiveSessionStatusGroup
} from './live-session-status'
import type { LiveSession } from './live-session-types'

export type LiveSessionGroupCounts = Record<LiveSessionStatusGroup, number>

/** How many sessions need the user, are busy, sit idle or have ended: the counts every overview shows. */
export function countLiveSessionGroups(
  sessions: readonly Pick<LiveSession, 'status'>[]
): LiveSessionGroupCounts {
  const counts: LiveSessionGroupCounts = { attention: 0, working: 0, idle: 0, finished: 0 }
  for (const session of sessions) {
    counts[liveSessionStatusGroup(session.status)] += 1
  }
  return counts
}

/** Running sessions blocked on the user or failed, most urgent first. */
export function liveSessionsNeedingAttention<
  T extends Pick<LiveSession, 'alive' | 'status' | 'lastActivityAt'>
>(sessions: readonly T[]): T[] {
  return sessions
    .filter(
      (session) =>
        isActiveLiveSession(session) && liveSessionStatusGroup(session.status) === 'attention'
    )
    .sort(compareLiveSessions)
}

/** What it asks or what went wrong, when the session says. */
export function liveSessionAttentionReason(
  session: Pick<LiveSession, 'permission' | 'statusDetail'>
): string | null {
  return session.permission?.question ?? session.statusDetail
}

/** Pinned first, then by urgency: the order every list of running sessions uses. */
export function compareListedLiveSessions(
  a: Pick<LiveSession, 'pinned' | 'status' | 'lastActivityAt'>,
  b: Pick<LiveSession, 'pinned' | 'status' | 'lastActivityAt'>
): number {
  return Number(b.pinned === true) - Number(a.pinned === true) || compareLiveSessions(a, b)
}

export type LiveSessionMachineGroup<T> = {
  hostId: string
  label: string
  kind: LiveSession['machine']['kind']
  sessions: T[]
}

/** Machines, this one first, each with its sessions in listed order. */
export function groupLiveSessionsByMachine<
  T extends Pick<LiveSession, 'machine' | 'pinned' | 'status' | 'lastActivityAt'>
>(sessions: readonly T[]): LiveSessionMachineGroup<T>[] {
  const machines = new Map<string, LiveSessionMachineGroup<T>>()
  for (const session of sessions) {
    const machine = machines.get(session.machine.hostId) ?? {
      hostId: session.machine.hostId,
      label: session.machine.label,
      kind: session.machine.kind,
      sessions: []
    }
    machine.sessions.push(session)
    machines.set(session.machine.hostId, machine)
  }
  for (const machine of machines.values()) {
    machine.sessions.sort(compareListedLiveSessions)
  }
  return [...machines.values()].sort((a, b) =>
    a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind === 'local' ? -1 : 1
  )
}
