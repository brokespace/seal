import type {
  ProviderRateLimits,
  RateLimitState
} from '../agent-usage/rate-limits/rate-limit-types'
import type { SealAccountCandidate } from './seal-account-candidates'
import { sealAccountKeysMatch } from './seal-account-key'
import type { SealAccountsStatus } from './seal-accounts-status'
import { SEAL_PROVIDERS } from './seal-accounts-config'

export type SealAccountUsageReading = { limits: ProviderRateLimits | null; fetching: boolean }

type ReadAccount = Pick<SealAccountCandidate, 'provider' | 'kind' | 'active' | 'localId' | 'key'>

/**
 * The reading the rate-limit state holds for one account. This is the only place that knows
 * which slot an account's usage lives in, so the usage popover, the host's account list and
 * every view of it name the same figures: the selected account's reading, a saved account's
 * own slot, or the machine's own login read while another account is selected.
 */
export function sealAccountUsageReading(
  rateLimits: RateLimitState | null | undefined,
  account: ReadAccount
): SealAccountUsageReading {
  if (!rateLimits || account.kind === 'api-key') {
    return { limits: null, fetching: false }
  }
  const { provider } = account
  if (account.active) {
    const target = provider === 'claude' ? rateLimits.claudeTarget : rateLimits.codexTarget
    // A WSL selection's reading is not this host account's.
    const limits = target.runtime === 'wsl' ? null : rateLimits[provider]
    return { limits, fetching: limits?.status === 'fetching' }
  }
  if (account.localId !== null) {
    const entries =
      provider === 'claude' ? rateLimits.inactiveClaudeAccounts : rateLimits.inactiveCodexAccounts
    const entry = entries?.find((candidate) => candidate.accountId === account.localId)
    return { limits: entry?.rateLimits ?? null, fetching: entry?.isFetching === true }
  }
  // Its own slot while another account is selected, and only when that reading is this login's.
  const kept = rateLimits.systemLoginUsage?.[provider]
  const own = kept && sealAccountKeysMatch(kept.identity, account.key) ? kept : null
  return { limits: own?.rateLimits ?? null, fetching: own?.isFetching === true }
}

/**
 * A host's account status with each account's usage taken from `rateLimits`, for a view that
 * holds that host's live rate-limit state: its figures then never trail the usage popover's.
 */
export function withLiveSealUsage(
  status: SealAccountsStatus,
  rateLimits: RateLimitState
): SealAccountsStatus {
  const providers = { ...status.providers }
  for (const provider of SEAL_PROVIDERS) {
    providers[provider] = {
      ...providers[provider],
      candidates: providers[provider].candidates.map((candidate) => {
        if (candidate.kind === 'api-key') {
          return candidate
        }
        const reading = sealAccountUsageReading(rateLimits, candidate)
        return { ...candidate, limits: reading.limits, usageFetching: reading.fetching }
      })
    }
  }
  return { ...status, providers }
}
