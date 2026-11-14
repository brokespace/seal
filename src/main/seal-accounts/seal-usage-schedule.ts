import type {
  SealAccountKey,
  SealAccountsConfig,
  SealProvider
} from '../../shared/seal-accounts/seal-accounts-config'
import type { SealAccountCandidate } from '../../shared/seal-accounts/seal-account-candidates'
import type { SealSessionAssignment } from '../../shared/seal-accounts/seal-accounts-status'
import { sealAccountKeysMatch } from '../../shared/seal-accounts/seal-account-key'
import { estimateSwap } from '../../shared/seal-accounts/seal-swap-estimate'
import { accountLines } from '../../shared/seal-accounts/seal-usage-lines'
import { SealUsagePoller, type SealUsageFetch } from './seal-usage-poller'
import type { SealAccountManager } from './seal-account-manager'

/** How often the session watch checks panes; a session unseen for three passes is not steered. */
export const SEAL_SESSION_TICK_MS = 60_000

/** A session whose pane was seen open on a recent pass; others cannot be steered. */
export function isLiveSealSession(session: SealSessionAssignment, now: number): boolean {
  return (
    !session.endedAt &&
    !!session.paneKey &&
    now - (session.lastSeenAt ?? 0) < 3 * SEAL_SESSION_TICK_MS
  )
}

/** The host's selected account plus every account a live session runs on. */
export function sealAccountsInUse(
  provider: SealProvider,
  candidates: readonly SealAccountCandidate[],
  sessions: readonly SealSessionAssignment[],
  now: number
): Set<SealAccountKey> {
  const keys = new Set<SealAccountKey>()
  for (const candidate of candidates) {
    const running = sessions.some(
      (session) =>
        session.provider === provider &&
        session.accountKey !== null &&
        isLiveSealSession(session, now) &&
        sealAccountKeysMatch(session.accountKey, candidate.key)
    )
    if (candidate.active || running) {
      keys.add(candidate.key)
    }
  }
  return keys
}

/** Polling only pays off where a swap can happen: a switch is on and there is somewhere to go. */
export function sealUsagePollingWanted(
  config: SealAccountsConfig,
  pollableCount: (provider: SealProvider) => number
): boolean {
  return (['claude', 'codex'] as const).some((provider) => {
    const settings = config.autoSwap[provider]
    return (settings.enabled || settings.liveSessionSwap !== false) && pollableCount(provider) >= 2
  })
}

/** Adds the poller's next read and, for accounts in use, when each is expected to swap. */
export function withUsageSchedule(
  candidates: SealAccountCandidate[],
  options: {
    poller: SealUsagePoller
    config: SealAccountsConfig
    inUse: ReadonlySet<SealAccountKey>
    now: number
  }
): SealAccountCandidate[] {
  return candidates.map((candidate) => {
    if (candidate.kind === 'api-key') {
      return candidate
    }
    const settings = options.config.autoSwap[candidate.provider]
    const samples = options.poller.samplesFor(candidate.key)
    return {
      ...candidate,
      nextPollAt: options.poller.nextPollAt(candidate.key),
      swapEstimate: options.inUse.has(candidate.key)
        ? estimateSwap(
            samples.latest,
            samples.previous,
            accountLines(candidate, settings),
            options.now
          )
        : null
    }
  })
}

export function createSealUsagePoller(
  manager: Pick<SealAccountManager, 'now' | 'baseCandidates' | 'getConfig' | 'accountsInUse'>,
  fetch: SealUsageFetch
): SealUsagePoller {
  const launchableCount = (provider: SealProvider) =>
    manager
      .baseCandidates(provider)
      .filter((candidate) => candidate.kind !== 'api-key' && candidate.launchable).length
  return new SealUsagePoller({
    now: manager.now,
    candidates: (provider) => manager.baseCandidates(provider),
    settings: (provider) => manager.getConfig().autoSwap[provider],
    inUse: (provider) => manager.accountsInUse(provider),
    wanted: () => sealUsagePollingWanted(manager.getConfig(), launchableCount),
    fetch
  })
}
