import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import {
  isActiveLiveSession,
  liveSessionStatusGroup
} from '../../../../../shared/live-sessions/live-session-status'
import {
  groupLiveSessionsByMachine,
  type LiveSessionMachineGroup
} from '../../../../../shared/live-sessions/live-session-summary'
import type { LiveSessionLink } from '../links/live-session-links'

export type ActiveAgentsChip = 'attention' | 'working' | 'mine'

/** Sessions of one workspace or project, as picked from its badge in Projects. */
export type ActiveAgentsScope = { kind: 'worktree' | 'project'; id: string; label: string }

export type ActiveAgentsFilter = {
  query: string
  chips: ReadonlySet<ActiveAgentsChip>
  scope: ActiveAgentsScope | null
}

/** Every session, as a surface without the toolbar lists them. */
export const NO_ACTIVE_AGENTS_FILTER: ActiveAgentsFilter = {
  query: '',
  chips: new Set(),
  scope: null
}

export type ActiveAgentsMachine = LiveSessionMachineGroup<LiveSession>

export type ActiveAgentsView = {
  machines: ActiveAgentsMachine[]
  /** Ended in the last day; still resumable or deletable. */
  finished: LiveSession[]
  /** Active sessions before filtering. */
  activeCount: number
}

/** `collapsedGroups` key of the whole section; machines and the finished group add their own. */
export const ACTIVE_AGENTS_COLLAPSE_KEY = 'active-agents'

export const RECENTLY_FINISHED_MS = 24 * 60 * 60 * 1000

function matchesQuery(session: LiveSession, link: LiveSessionLink | undefined, words: string[]) {
  const haystack = [
    session.customTitle,
    session.title,
    session.project,
    session.cwd,
    link?.name,
    session.machine.label,
    session.provider === 'claude' ? 'claude code' : 'codex',
    session.status.replace('-', ' '),
    liveSessionStatusGroup(session.status),
    session.statusDetail,
    session.configDir
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase()
  return words.every((word) => haystack.includes(word))
}

function passes(
  session: LiveSession,
  filter: ActiveAgentsFilter,
  link: LiveSessionLink | undefined,
  words: string[]
): boolean {
  const group = liveSessionStatusGroup(session.status)
  const { chips, scope } = filter
  // Status chips widen each other; "mine" narrows whatever they leave.
  const statusChips = chips.has('attention') || chips.has('working')
  if (
    statusChips &&
    !(chips.has('attention') && group === 'attention') &&
    !(chips.has('working') && group === 'working')
  ) {
    return false
  }
  if (chips.has('mine') && session.machine.kind !== 'local') {
    return false
  }
  if (scope && (scope.kind === 'worktree' ? link?.worktreeId : link?.repoId) !== scope.id) {
    return false
  }
  return matchesQuery(session, link, words)
}

/** Machines (this one first), each with its sessions: pinned, then needs-attention, working, idle. */
export function buildActiveAgents(
  sessions: readonly LiveSession[],
  filter: ActiveAgentsFilter,
  links: ReadonlyMap<string, LiveSessionLink>,
  now: number
): ActiveAgentsView {
  const words = filter.query.toLowerCase().split(/\s+/).filter(Boolean)
  const running: LiveSession[] = []
  const finished: LiveSession[] = []
  let activeCount = 0
  for (const session of sessions) {
    const active = isActiveLiveSession(session)
    if (active) {
      activeCount++
    } else if (now - session.lastActivityAt > RECENTLY_FINISHED_MS && !session.pinned) {
      continue
    }
    if (!passes(session, filter, links.get(session.id), words)) {
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
