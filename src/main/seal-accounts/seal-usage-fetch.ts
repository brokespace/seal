import type { SealAccountCandidate } from '../../shared/seal-accounts/seal-account-candidates'
import type { ProviderAccountServices } from '../providers/accounts/provider-account-services'
import type { SealUsageFetch } from './seal-usage-poller'

/** A reading this young is served again rather than spending the endpoint's small budget. */
const RECENT_READING_MS = 30_000

/**
 * Seal's poller decides when an account is read; the rate-limit service does the reading, into
 * the state the usage popover shows, with its own stale policy and Retry-After. An account the
 * service holds no slot for (a machine login that is neither saved nor selected) stays unread.
 */
export function sealUsageFetcher(
  services: Pick<ProviderAccountServices, 'rateLimits'>
): SealUsageFetch {
  return async (candidate: SealAccountCandidate) => {
    if (!candidate.active && candidate.localId === null) {
      return null
    }
    return services.rateLimits.readAccountUsage(
      candidate.provider,
      candidate.active ? null : candidate.localId,
      // HTTP first: a poll every few minutes must not spawn `codex app-server` each time.
      { notWithinMs: RECENT_READING_MS, preferBackend: true }
    )
  }
}
