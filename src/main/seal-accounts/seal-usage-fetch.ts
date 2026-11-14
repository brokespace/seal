import type { SealAccountCandidate } from '../../shared/seal-accounts/seal-account-candidates'
import type { SealAccountKey } from '../../shared/seal-accounts/seal-accounts-config'
import {
  parseSealAccountKey,
  sealAccountKeysMatch
} from '../../shared/seal-accounts/seal-account-key'
import type { ProviderAccountServices } from '../providers/accounts/provider-account-services'
import type { SealAccountManager } from './seal-account-manager'
import type { SealUsageFetch } from './seal-usage-poller'

/**
 * Seal's poller decides when an account is read; the rate-limit service does the reading, into
 * the state the usage popover shows, with its own stale policy, Retry-After and per-account
 * request budget.
 */
export function sealUsageFetcher(
  services: Pick<ProviderAccountServices, 'rateLimits'>
): SealUsageFetch {
  return async (candidate: SealAccountCandidate) => {
    // HTTP first: a poll every few minutes must not spawn `codex app-server` each time.
    const options = { preferBackend: true }
    if (!candidate.active && candidate.localId === null) {
      // The machine's own login, unsaved, while a saved account is the selection.
      return candidate.kind === 'system'
        ? services.rateLimits.readSystemLoginUsage(candidate.provider, candidate.key, options)
        : null
    }
    return services.rateLimits.readAccountUsage(
      candidate.provider,
      candidate.active ? null : candidate.localId,
      options
    )
  }
}

/** A new login makes the account's samples and failed checks obsolete. */
export function forgetSealAccountUsage(
  manager: Pick<SealAccountManager, 'usage' | 'baseCandidates' | 'services'>,
  key: SealAccountKey
): void {
  manager.usage.forget(key)
  const provider = parseSealAccountKey(key)?.provider
  const candidate = provider
    ? manager.baseCandidates(provider).find((entry) => sealAccountKeysMatch(entry.key, key))
    : undefined
  if (candidate && candidate.kind !== 'api-key') {
    manager.services.rateLimits.forgetAccountReadAttempts(
      candidate.provider,
      candidate.active ? null : candidate.localId
    )
  }
}
