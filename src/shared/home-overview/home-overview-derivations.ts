import type {
  HomeAccount,
  HomeMachine,
  HomeSession,
  HomeSessionState,
  HomeUsageWindow
} from './home-overview-types'

export const ACCOUNT_NEAR_LIMIT_PERCENT = 80

const STATE_PRIORITY: Record<HomeSessionState, number> = {
  permission: 0,
  waiting: 1,
  errored: 2,
  working: 3,
  done: 4,
  idle: 5
}

export function compareHomeSessions(a: HomeSession, b: HomeSession): number {
  const byState = STATE_PRIORITY[a.state] - STATE_PRIORITY[b.state]
  if (byState !== 0) {
    return byState
  }
  return (b.stateChangedAt || b.startedAt) - (a.stateChangedAt || a.startedAt)
}

export function sessionNeedsAttention(session: HomeSession): boolean {
  return (
    session.state === 'permission' ||
    session.state === 'waiting' ||
    (session.state === 'errored' && session.unseen)
  )
}

export type HomeProjectGroup = { projectId: string; projectName: string; sessions: HomeSession[] }

export type HomeMachineGroup = {
  machineId: string
  machineLabel: string
  projects: HomeProjectGroup[]
  sessionCount: number
}

/** Local machine first, then machines and projects ordered by their most urgent session. */
export function groupHomeSessions(sessions: readonly HomeSession[]): HomeMachineGroup[] {
  const sorted = [...sessions].sort(compareHomeSessions)
  const machines = new Map<
    string,
    HomeMachineGroup & { byProject: Map<string, HomeProjectGroup> }
  >()
  for (const session of sorted) {
    let machine = machines.get(session.machineId)
    if (!machine) {
      machine = {
        machineId: session.machineId,
        machineLabel: session.machineLabel,
        projects: [],
        sessionCount: 0,
        byProject: new Map()
      }
      machines.set(session.machineId, machine)
    }
    let project = machine.byProject.get(session.projectId)
    if (!project) {
      project = { projectId: session.projectId, projectName: session.projectName, sessions: [] }
      machine.byProject.set(session.projectId, project)
      machine.projects.push(project)
    }
    project.sessions.push(session)
    machine.sessionCount += 1
  }
  const groups = [...machines.values()].map(({ byProject: _byProject, ...group }) => group)
  const local = groups.filter((group) => group.machineId === 'local')
  return [...local, ...groups.filter((group) => group.machineId !== 'local')]
}

export function countSessionsByState(
  sessions: readonly HomeSession[]
): Record<HomeSessionState, number> {
  const counts: Record<HomeSessionState, number> = {
    working: 0,
    waiting: 0,
    permission: 0,
    errored: 0,
    done: 0,
    idle: 0
  }
  for (const session of sessions) {
    counts[session.state] += 1
  }
  return counts
}

export function peakUsageWindow(account: HomeAccount): HomeUsageWindow | null {
  let peak: HomeUsageWindow | null = null
  for (const window of account.windows) {
    if (!peak || window.usedPercent > peak.usedPercent) {
      peak = window
    }
  }
  return peak
}

export function accountNearLimit(account: HomeAccount): boolean {
  return (peakUsageWindow(account)?.usedPercent ?? 0) >= ACCOUNT_NEAR_LIMIT_PERCENT
}

/** Earliest future reset; for an account near its limit, the reset of the window that is close. */
export function accountNextReset(account: HomeAccount, now: number): number | null {
  const candidates = accountNearLimit(account)
    ? account.windows.filter((window) => window.usedPercent >= ACCOUNT_NEAR_LIMIT_PERCENT)
    : account.windows
  let next: number | null = null
  for (const window of candidates) {
    if (
      window.resetsAt !== null &&
      window.resetsAt > now &&
      (next === null || window.resetsAt < next)
    ) {
      next = window.resetsAt
    }
  }
  return next
}

export type HomeAttentionItem = {
  id: string
  session: HomeSession
  /** What the agent is asking, or what went wrong, when the provider says. */
  reason: string | null
}

/** Only agent sessions that are blocked on the user or failed; hosts and accounts have their own pages. */
export function buildHomeAttentionItems(sessions: readonly HomeSession[]): HomeAttentionItem[] {
  return sessions
    .filter(sessionNeedsAttention)
    .sort(compareHomeSessions)
    .map((session) => ({
      id: `session:${session.id}`,
      session,
      reason: (session.state === 'errored' ? session.errorSummary : session.askSummary) ?? null
    }))
}

/** Machines known to the machines provider plus any that only appear as a session's host. */
export function mergeSessionMachines(
  machines: readonly HomeMachine[],
  sessions: readonly HomeSession[]
): HomeMachine[] {
  const merged = [...machines]
  const known = new Set(machines.map((machine) => machine.id))
  for (const session of sessions) {
    if (!known.has(session.machineId)) {
      known.add(session.machineId)
      merged.push({
        id: session.machineId,
        label: session.machineLabel,
        kind: session.machineId.startsWith('runtime:') ? 'runtime' : 'ssh',
        // A host still reporting agent status is reachable.
        status: 'online'
      })
    }
  }
  return merged
}

export type HomeElapsed = { value: number; unit: 'second' | 'minute' | 'hour' | 'day' }

export function homeElapsed(fromMs: number, nowMs: number): HomeElapsed | null {
  if (!fromMs || fromMs > nowMs + 60_000) {
    return null
  }
  const seconds = Math.max(0, Math.floor((nowMs - fromMs) / 1000))
  if (seconds < 60) {
    return { value: seconds, unit: 'second' }
  }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return { value: minutes, unit: 'minute' }
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 48) {
    return { value: hours, unit: 'hour' }
  }
  return { value: Math.floor(hours / 24), unit: 'day' }
}
