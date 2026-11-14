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
import type {
  HomeAccount,
  HomeAccountStatus,
  HomeMachine,
  HomeUsageWindow
} from './home-overview-model'

export function homeMachineFromSummary(
  summary: MachineSummary,
  metrics: MachineMetrics | null | undefined,
  localLabel: string
): HomeMachine {
  const load = machineLoad(metrics)
  const memoryUsedPercent = machineMemoryUsedPercent(metrics)
  return {
    id: summary.id,
    executionHostId: summary.executionHostId,
    sshTargetId: summary.sshTargetId,
    runtimeEnvironmentId: summary.runtimeEnvironmentId,
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
