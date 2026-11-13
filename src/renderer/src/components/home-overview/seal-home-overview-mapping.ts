import { LOCAL_EXECUTION_HOST_ID, toSshExecutionHostId } from '../../../../shared/execution-host'
import type {
  LiveSession,
  LiveSessionStatus
} from '../../../../shared/live-sessions/live-session-types'
import type { MachineMetrics } from '../../../../shared/machines/machine-types'
import type { SealAccountCandidate } from '../../../../shared/seal-accounts/seal-account-candidates'
import { SEAL_PROVIDERS } from '../../../../shared/seal-accounts/seal-accounts-config'
import type { SealAccountsStatus } from '../../../../shared/seal-accounts/seal-accounts-status'
import type { MachineSummary } from '../../../../shared/machines/machine-summaries'
import {
  liveSessionProviderLabel,
  liveSessionTitle
} from '../live-sessions/live-session-presentation'
import { sessionForTab } from '../seal-session/seal-session-account-view'
import type {
  HomeAccount,
  HomeAccountStatus,
  HomeMachine,
  HomeSession,
  HomeSessionState,
  HomeUsageWindow
} from './home-overview-model'

function homeStateFromLive(status: LiveSessionStatus): HomeSessionState {
  switch (status) {
    case 'working':
      return 'working'
    case 'waiting-input':
      return 'waiting'
    case 'needs-permission':
      return 'permission'
    case 'errored':
      return 'errored'
    case 'done':
      return 'done'
  }
}

export function liveSessionMachineId(session: Pick<LiveSession, 'machine'>): string {
  return session.machine.kind === 'local'
    ? LOCAL_EXECUTION_HOST_ID
    : toSshExecutionHostId(session.machine.hostId)
}

export function homeSessionFromLive(session: LiveSession): HomeSession {
  const state = homeStateFromLive(session.status)
  const machineId = liveSessionMachineId(session)
  const project = session.project ?? session.cwd ?? session.machine.label
  const askSummary =
    session.permission?.question ??
    (state === 'waiting' || state === 'permission' ? session.statusDetail : null)
  return {
    id: session.id,
    state,
    unseen: false,
    machineId,
    machineLabel: session.machine.label,
    projectId: `${machineId}:${session.cwd ?? project}`,
    projectName: project,
    workspaceName: session.project ?? '',
    title: liveSessionTitle(session),
    agentType: session.provider,
    agentLabel: liveSessionProviderLabel(session),
    startedAt: session.startedAt ?? session.lastActivityAt,
    stateChangedAt: session.lastActivityAt,
    finishedAt: state === 'done' ? session.lastActivityAt : null,
    ...(askSummary ? { askSummary } : {}),
    target: { kind: 'live-session', sessionId: session.id }
  }
}

/**
 * Seal's own panes come from the dashboard (they open the pane); the registry adds sessions running
 * outside Seal. Finished transcripts the registry still remembers stay on the Agent sessions page.
 */
export function mergeLiveSessions(
  paneSessions: readonly HomeSession[],
  liveSessions: readonly LiveSession[]
): HomeSession[] {
  const paneKeys = new Set(paneSessions.map((session) => session.id))
  const merged = [...paneSessions]
  for (const live of liveSessions) {
    if (!live.alive && live.status === 'done') {
      continue
    }
    const shownAsPane = live.inputRoutes.some(
      (route) => route.kind === 'seal-pane' && paneKeys.has(route.paneKey)
    )
    if (!shownAsPane) {
      merged.push(homeSessionFromLive(live))
    }
  }
  return merged
}

function percentOf(used: number, total: number): number {
  return Math.max(0, Math.min(100, (used / total) * 100))
}

export function homeMachineFromSummary(
  summary: MachineSummary,
  metrics: MachineMetrics | null | undefined,
  localLabel: string
): HomeMachine {
  let load: number | undefined
  if (metrics?.loadAverage && metrics.cpuCount) {
    load = metrics.loadAverage[0] / metrics.cpuCount
  } else if (metrics?.cpuUsagePercent != null) {
    load = metrics.cpuUsagePercent / 100
  }
  const memoryUsedPercent =
    metrics?.memTotalBytes && metrics.memAvailableBytes != null
      ? percentOf(metrics.memTotalBytes - metrics.memAvailableBytes, metrics.memTotalBytes)
      : undefined
  return {
    id: summary.id,
    label: summary.kind === 'local' ? localLabel : summary.label,
    kind: summary.kind,
    status: summary.status,
    ...(load !== undefined ? { load } : {}),
    ...(memoryUsedPercent !== undefined ? { memoryUsedPercent } : {}),
    ...(summary.statusDetail ? { error: summary.statusDetail } : {})
  }
}

const SEAL_PROVIDER_LABELS: Record<(typeof SEAL_PROVIDERS)[number], string> = {
  claude: 'Claude',
  codex: 'Codex'
}

function sealCandidateStatus(candidate: SealAccountCandidate): HomeAccountStatus {
  if (candidate.authFailure || candidate.usage?.error) {
    return 'error'
  }
  if (candidate.kind === 'api-key') {
    return 'unavailable'
  }
  return candidate.usage ? 'ok' : 'loading'
}

function sealCandidateWindows(candidate: SealAccountCandidate): HomeUsageWindow[] {
  const windows: HomeUsageWindow[] = []
  if (candidate.usage?.session) {
    windows.push({ kind: 'session', ...candidate.usage.session })
  }
  if (candidate.usage?.weekly) {
    windows.push({ kind: 'weekly', ...candidate.usage.weekly })
  }
  return windows
}

/** Every enabled vault account on this machine, the one new sessions use first per provider. */
export function homeAccountsFromSeal(status: SealAccountsStatus): HomeAccount[] {
  const accounts: HomeAccount[] = []
  for (const provider of SEAL_PROVIDERS) {
    const candidates = status.providers[provider]?.candidates ?? []
    const ordered = [...candidates.filter((c) => c.active), ...candidates.filter((c) => !c.active)]
    for (const candidate of ordered) {
      if (candidate.disabled) {
        continue
      }
      const error = candidate.usage?.error ?? undefined
      accounts.push({
        id: `seal:${candidate.key}`,
        provider,
        providerLabel: SEAL_PROVIDER_LABELS[provider],
        label: candidate.label || candidate.email || SEAL_PROVIDER_LABELS[provider],
        active: candidate.active,
        status: sealCandidateStatus(candidate),
        windows: sealCandidateWindows(candidate),
        ...(error ? { error } : {})
      })
    }
  }
  return accounts
}

/** Vault accounts replace the Claude/Codex rows; other providers keep their rate-limit rows. */
export function mergeSealAccounts(
  orcaAccounts: readonly HomeAccount[],
  status: SealAccountsStatus | null
): HomeAccount[] {
  if (!status) {
    return [...orcaAccounts]
  }
  const sealProviders = new Set<string>(SEAL_PROVIDERS)
  return [
    ...homeAccountsFromSeal(status),
    ...orcaAccounts.filter((account) => !sealProviders.has(account.provider))
  ]
}

/** Labels local pane sessions with the vault account Seal launched them on. */
export function applySealSessionAccounts(
  sessions: readonly HomeSession[],
  status: SealAccountsStatus | null
): HomeSession[] {
  if (!status) {
    return [...sessions]
  }
  return sessions.map((session) => {
    if (session.machineId !== LOCAL_EXECUTION_HOST_ID || session.target.kind !== 'orca-pane') {
      return session
    }
    const account = sessionForTab(status.sessions, session.target.reveal.tabId)?.accountLabel
    return account ? { ...session, account } : session
  })
}
