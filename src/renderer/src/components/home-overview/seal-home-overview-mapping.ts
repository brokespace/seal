import {
  LOCAL_EXECUTION_HOST_ID,
  toRuntimeExecutionHostId,
  toSshExecutionHostId
} from '../../../../shared/execution-host'
import type { LiveSession } from '../../../../shared/live-sessions/live-session-types'
import { homeSessionFromLive as homeSessionFromLiveFields } from '../../../../shared/home-overview/home-live-session-mapping'
import type { MachineMetrics } from '../../../../shared/machines/machine-types'
import type { SealAccountCandidate } from '../../../../shared/seal-accounts/seal-account-candidates'
import { SEAL_PROVIDERS } from '../../../../shared/seal-accounts/seal-accounts-config'
import type { SealAccountsStatus } from '../../../../shared/seal-accounts/seal-accounts-status'
import { translate } from '@/i18n/i18n'
import type { MachineSummary } from '../../../../shared/machines/machine-summaries'
import {
  machineLoad,
  machineMemoryUsedPercent
} from '../../../../shared/home-overview/home-machine-readings'
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
  HomeUsageWindow
} from './home-overview-model'

/** Pane sessions name the execution host they run on; home groups by machine, whichever transport. */
export function unifySessionMachines(
  sessions: readonly HomeSession[],
  machines: readonly MachineSummary[]
): HomeSession[] {
  const byHost = new Map<string, MachineSummary>()
  for (const machine of machines) {
    byHost.set(machine.id, machine)
    byHost.set(machine.executionHostId, machine)
    if (machine.sshTargetId) {
      byHost.set(toSshExecutionHostId(machine.sshTargetId), machine)
    }
    if (machine.runtimeEnvironmentId) {
      byHost.set(toRuntimeExecutionHostId(machine.runtimeEnvironmentId), machine)
    }
  }
  return sessions.map((session) => {
    const machine = byHost.get(session.machineId)
    if (!machine || machine.id === session.machineId) {
      return session
    }
    return {
      ...session,
      machineId: machine.id,
      machineLabel: machine.connection === 'local' ? session.machineLabel : machine.label
    }
  })
}

export function homeSessionFromLive(session: LiveSession): HomeSession {
  return homeSessionFromLiveFields(session, {
    title: liveSessionTitle(session),
    agentLabel: liveSessionProviderLabel(session)
  })
}

/**
 * Seal's own panes come from the dashboard (they open the pane); the registry adds sessions running
 * outside Seal. Finished transcripts the registry still remembers stay under Recently finished in
 * Active agents.
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

export function homeMachineFromSummary(
  summary: MachineSummary,
  metrics: MachineMetrics | null | undefined,
  localLabel: string
): HomeMachine {
  const load = machineLoad(metrics)
  const memoryUsedPercent = machineMemoryUsedPercent(metrics)
  return {
    id: summary.id,
    label: summary.connection === 'local' ? localLabel : summary.label,
    kind: summary.connection === 'server' ? 'runtime' : summary.connection,
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
  if (candidate.health?.state === 'dead' || candidate.authFailure || candidate.usage?.error) {
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
      const error =
        candidate.health?.state === 'dead'
          ? translate('seal.accounts.home.signInAgain', 'Sign in again in Settings > Accounts')
          : (candidate.usage?.error ?? undefined)
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
