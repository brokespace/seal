import { LOCAL_EXECUTION_HOST_ID } from '../../../../../shared/execution-host'
import type {
  LiveSession,
  LiveSessionMachine
} from '../../../../../shared/live-sessions/live-session-types'
import { isActiveLiveSession } from '../../../../../shared/live-sessions/live-session-status'
import {
  groupLiveSessionsByMachine,
  type LiveSessionMachineGroup
} from '../../../../../shared/live-sessions/live-session-summary'

export type ActiveAgentsMachine = LiveSessionMachineGroup<LiveSession>

export type ActiveAgentsView = {
  machines: ActiveAgentsMachine[]
  /** Ended in the last day; still resumable or deletable. */
  finished: LiveSession[]
  /** Active sessions on every machine. */
  activeCount: number
}

/** `collapsedGroups` key of the whole section; machines and the finished group add their own. */
export const ACTIVE_AGENTS_COLLAPSE_KEY = 'active-agents'

/** The section's own fold keys; unlike project group keys, they mean the same under every Projects grouping. */
export function isActiveAgentsCollapseKey(key: string): boolean {
  return key === ACTIVE_AGENTS_COLLAPSE_KEY || key.startsWith(`${ACTIVE_AGENTS_COLLAPSE_KEY}:`)
}

export const RECENTLY_FINISHED_MS = 24 * 60 * 60 * 1000

/** An ended session stays listed for a day, and for as long as it is pinned. */
export function isRecentlyFinishedLiveSession(
  session: Pick<LiveSession, 'lastActivityAt' | 'pinned'>,
  now: number
): boolean {
  return now - session.lastActivityAt <= RECENTLY_FINISHED_MS || session.pinned === true
}

/** What a sessions list shows at all: every running session, and an ended one while it is recent or pinned. */
export function isListedLiveSession(session: LiveSession, now: number): boolean {
  return isActiveLiveSession(session) || isRecentlyFinishedLiveSession(session, now)
}

/** A machine with no session to name it, as a failed scan reports it: by its host id. */
export function machineKnownByHostId(hostId: string): Pick<LiveSessionMachine, 'kind' | 'label'> {
  return { kind: hostId === LOCAL_EXECUTION_HOST_ID ? 'local' : 'remote', label: hostId }
}

/** Machines (this one first), each with its sessions: pinned, then needs-attention, working, idle. */
export function buildActiveAgents(sessions: readonly LiveSession[], now: number): ActiveAgentsView {
  const running: LiveSession[] = []
  const finished: LiveSession[] = []
  let activeCount = 0
  for (const session of sessions) {
    if (isActiveLiveSession(session)) {
      activeCount++
      running.push(session)
    } else if (isRecentlyFinishedLiveSession(session, now)) {
      finished.push(session)
    }
  }
  return {
    machines: groupLiveSessionsByMachine(running),
    finished: finished.sort((a, b) => b.lastActivityAt - a.lastActivityAt),
    activeCount
  }
}

/** Rows in the order the list shows them, for arrow keys and shift-click ranges. */
export function visibleSessionIds(
  view: ActiveAgentsView,
  collapsed: { machines: ReadonlySet<string>; finished: boolean }
): string[] {
  return [
    ...view.machines
      .filter((machine) => !collapsed.machines.has(machine.hostId))
      .flatMap((machine) => machine.sessions.map((session) => session.id)),
    ...(collapsed.finished ? [] : view.finished.map((session) => session.id))
  ]
}
