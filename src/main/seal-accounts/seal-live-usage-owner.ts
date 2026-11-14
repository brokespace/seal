import type { SealAccountCandidate } from '../../shared/seal-accounts/seal-account-candidates'
import { sealAccountKeysMatch } from '../../shared/seal-accounts/seal-account-key'
import type {
  LiveClaudeUsageOwner,
  LiveClaudeUsageOwnerResolver
} from '../rate-limits/service/service-live-claude-usage'
import { normalizeClaudeConfigDir } from '../rate-limits/service/service-types'
import type { SealAccountManager } from './seal-account-manager'

/** A request sent on the outgoing login can still answer this long after a session moved. */
const SWAP_SETTLE_MS = 60_000

type OwnerManager = Pick<SealAccountManager, 'baseCandidates' | 'store' | 'services' | 'now'>

type HomeReport = {
  figures: string
  /** What the home last reported before the session's latest move to another login. */
  outgoing: { swapAt: number; figures: string | null } | null
}

function ownerOf(candidate: SealAccountCandidate | undefined): LiveClaudeUsageOwner | null {
  if (!candidate) {
    return null
  }
  if (candidate.active) {
    return { kind: 'selected' }
  }
  if (candidate.kind === 'system') {
    return { kind: 'system', identity: candidate.key }
  }
  return candidate.kind === 'oauth' && candidate.localId
    ? { kind: 'account', accountId: candidate.localId }
    : null
}

/**
 * Names the account a running Claude session reports usage for, from the folder it runs in: a
 * session's own home, a saved account's folder, or the machine's own login. This is what lets
 * every account's reading follow its sessions, not only the selected account's.
 */
export function createSealLiveUsageOwnerResolver(
  manager: OwnerManager
): LiveClaudeUsageOwnerResolver {
  const reports = new Map<string, HomeReport>()
  return (event) => {
    const dir = normalizeClaudeConfigDir(event.configDir)
    const router = manager.services.claudeRuntimeAuth.router
    const candidates = manager.baseCandidates('claude')
    if (dir === normalizeClaudeConfigDir(router.userConfigDir())) {
      return ownerOf(candidates.find((candidate) => candidate.systemLogin))
    }
    const session = manager.store
      .getState()
      .sessions.find(
        (entry) =>
          entry.provider === 'claude' &&
          entry.accountKey !== null &&
          normalizeClaudeConfigDir(entry.profileHome) === dir
      )
    if (!session || !dir) {
      return ownerOf(
        candidates.find(
          (candidate) =>
            candidate.kind === 'oauth' &&
            candidate.localId !== null &&
            normalizeClaudeConfigDir(router.accountHome(candidate.localId)) === dir
        )
      )
    }
    const figures = JSON.stringify([event.fiveHour, event.sevenDay])
    const swapAt = session.lastSwapAt ?? null
    const seen = reports.get(dir)
    const outgoing =
      swapAt !== null && seen?.outgoing?.swapAt !== swapAt
        ? { swapAt, figures: seen?.figures ?? null }
        : (seen?.outgoing ?? null)
    reports.set(dir, { figures, outgoing })
    // Until the session's next turn answers, its statusline repeats the outgoing login's figures.
    if (
      outgoing &&
      (manager.now() < outgoing.swapAt + SWAP_SETTLE_MS || figures === outgoing.figures)
    ) {
      return null
    }
    const key = session.accountKey
    return ownerOf(
      candidates.find((candidate) => key !== null && sealAccountKeysMatch(candidate.key, key))
    )
  }
}

export function installSealLiveUsageOwner(manager: OwnerManager): void {
  manager.services.rateLimits.setLiveClaudeUsageOwnerResolver(
    createSealLiveUsageOwnerResolver(manager)
  )
}
