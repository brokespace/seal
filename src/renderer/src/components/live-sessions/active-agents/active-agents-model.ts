import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { isActiveLiveSession } from '../../../../../shared/live-sessions/live-session-status'
import {
  groupLiveSessionsByMachine,
  type LiveSessionMachineGroup
} from '../../../../../shared/live-sessions/live-session-summary'
import type { LiveSessionLink } from '../links/live-session-links'

/** Sessions of one workspace or project, as picked from its badge in Projects. */
export type ActiveAgentsScope = { kind: 'worktree' | 'project'; id: string; label: string }

export type ActiveAgentsMachine = LiveSessionMachineGroup<LiveSession>

export type ActiveAgentsView = {
  machines: ActiveAgentsMachine[]
  /** Ended in the last day; still resumable or deletable. */
  finished: LiveSession[]
  /** Active sessions on every machine, whatever the scope. */
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

function inScope(scope: ActiveAgentsScope | null, link: LiveSessionLink | undefined): boolean {
  return !scope || (scope.kind === 'worktree' ? link?.worktreeId : link?.repoId) === scope.id
}

/** Machines (this one first), each with its sessions: pinned, then needs-attention, working, idle. */
export function buildActiveAgents(
  sessions: readonly LiveSession[],
  scope: ActiveAgentsScope | null,
  links: ReadonlyMap<string, LiveSessionLink>,
  now: number
): ActiveAgentsView {
  const running: LiveSession[] = []
  const finished: LiveSession[] = []
  let activeCount = 0
  for (const session of sessions) {
    const active = isActiveLiveSession(session)
    if (active) {
      activeCount++
    } else if (!isRecentlyFinishedLiveSession(session, now)) {
      continue
    }
    if (!inScope(scope, links.get(session.id))) {
      continue
    }
    if (!active) {
      finished.push(session)
      continue
    }
    running.push(session)
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
