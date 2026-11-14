import type {
  LiveSession,
  LiveSessionStatus
} from '../../../../../shared/live-sessions/live-session-types'
import {
  compareLiveSessions,
  isActiveLiveSession,
  liveSessionStatusGroup,
  topLiveSessionStatus
} from '../../../../../shared/live-sessions/live-session-status'

/** The workspace a session runs in, when Seal knows one. */
export type LiveSessionLink = { worktreeId: string; repoId: string; name: string }

export type LinkableWorktree = {
  id: string
  repoId: string
  path: string
  name: string
  /** The execution host that owns it; null when unknown. */
  hostId: string | null
}

export type ActiveAgentsChip = 'attention' | 'working' | 'mine'

/** Sessions of one workspace or project, as picked from its badge in Projects. */
export type ActiveAgentsScope = { kind: 'worktree' | 'project'; id: string; label: string }

export type ActiveAgentsFilter = {
  query: string
  chips: ReadonlySet<ActiveAgentsChip>
  scope: ActiveAgentsScope | null
}

export type ActiveAgentsMachine = {
  hostId: string
  label: string
  kind: LiveSession['machine']['kind']
  sessions: LiveSession[]
}

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

/**
 * A Seal pane's session belongs to the workspace its tab is in; any other belongs to the workspace
 * whose folder holds its cwd on the same host. Sessions elsewhere stay unlinked.
 */
export function linkLiveSessions(
  sessions: readonly LiveSession[],
  worktrees: readonly LinkableWorktree[],
  worktreeIdByTabId: ReadonlyMap<string, string>,
  hostOf: (session: LiveSession) => string
): Map<string, LiveSessionLink> {
  const byId = new Map(worktrees.map((worktree) => [worktree.id, worktree]))
  const links = new Map<string, LiveSessionLink>()
  for (const session of sessions) {
    let found: LinkableWorktree | undefined
    for (const route of session.inputRoutes) {
      const separator = route.kind === 'seal-pane' ? route.paneKey.lastIndexOf(':') : -1
      if (route.kind === 'seal-pane' && separator > 0) {
        found = byId.get(worktreeIdByTabId.get(route.paneKey.slice(0, separator)) ?? '')
      }
    }
    const cwd = session.cwd
    if (!found && cwd) {
      const host = hostOf(session)
      found = worktrees
        .filter(
          (worktree) =>
            worktree.hostId === host &&
            (cwd === worktree.path || cwd.startsWith(`${worktree.path}/`))
        )
        .sort((a, b) => b.path.length - a.path.length)[0]
    }
    if (found) {
      links.set(session.id, { worktreeId: found.id, repoId: found.repoId, name: found.name })
    }
  }
  return links
}

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

function order(a: LiveSession, b: LiveSession): number {
  return Number(b.pinned === true) - Number(a.pinned === true) || compareLiveSessions(a, b)
}

/** Machines (this one first), each with its sessions: pinned, then needs-attention, working, idle. */
export function buildActiveAgents(
  sessions: readonly LiveSession[],
  filter: ActiveAgentsFilter,
  links: ReadonlyMap<string, LiveSessionLink>,
  now: number
): ActiveAgentsView {
  const words = filter.query.toLowerCase().split(/\s+/).filter(Boolean)
  const machines = new Map<string, ActiveAgentsMachine>()
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
    machine.sessions.sort(order)
  }
  return {
    machines: [...machines.values()].sort((a, b) =>
      a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind === 'local' ? -1 : 1
    ),
    finished: finished.sort((a, b) => b.lastActivityAt - a.lastActivityAt),
    activeCount
  }
}

export type LiveSessionsBadge = { count: number; status: LiveSessionStatus; sessionIds: string[] }

/** Per workspace and per project: how many live sessions it has and the most urgent status among them. */
export function liveSessionBadges(
  sessions: readonly LiveSession[],
  links: ReadonlyMap<string, LiveSessionLink>
): { byWorktree: Map<string, LiveSessionsBadge>; byProject: Map<string, LiveSessionsBadge> } {
  const byWorktree = new Map<string, LiveSession[]>()
  const byProject = new Map<string, LiveSession[]>()
  for (const session of sessions) {
    const link = links.get(session.id)
    if (!link || !isActiveLiveSession(session)) {
      continue
    }
    byWorktree.set(link.worktreeId, [...(byWorktree.get(link.worktreeId) ?? []), session])
    byProject.set(link.repoId, [...(byProject.get(link.repoId) ?? []), session])
  }
  const badge = (group: LiveSession[]): LiveSessionsBadge => ({
    count: group.length,
    status: topLiveSessionStatus(group.map((session) => session.status))!,
    sessionIds: group.map((session) => session.id)
  })
  return {
    byWorktree: new Map([...byWorktree].map(([id, group]) => [id, badge(group)])),
    byProject: new Map([...byProject].map(([id, group]) => [id, badge(group)]))
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
