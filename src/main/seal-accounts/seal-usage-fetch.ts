import type { ProviderRateLimits } from '../../shared/rate-limit-types'
import type { SealAccountCandidate } from '../../shared/seal-accounts/seal-account-candidates'
import { fetchActiveClaudeRateLimits } from '../rate-limits/providers/claude/claude-active-usage-fetch'
import { fetchInactiveClaudeAccountUsage } from '../rate-limits/providers/claude/claude-managed-account-usage'
import { claudeOAuthUsageDisabledResult } from '../rate-limits/providers/claude/claude-usage-result'
import { fetchCodexRateLimits } from '../rate-limits/providers/codex/codex-fetcher'
import type { SealAccountManager } from './seal-account-manager'
import type { SealUsageFetch } from './seal-usage-poller'

const FETCH_TIMEOUT_MS = 30_000

/**
 * Reads one account's usage the way Orca's usage bar does: Claude's OAuth usage endpoint
 * (`/api/oauth/usage`, the 5h/7d/per-model windows) through that account's own login, and Codex's
 * rate limits from that account's own CODEX_HOME. Observes only; never refreshes a login.
 */
export function sealUsageFetcher(
  manager: Pick<SealAccountManager, 'codexHome' | 'deps'>
): SealUsageFetch {
  return async (candidate: SealAccountCandidate): Promise<ProviderRateLimits> => {
    const settings = manager.deps.store.getSettings()
    const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS)
    if (candidate.provider === 'claude') {
      if (!settings.claudeOAuthUsageEnabled) {
        return claudeOAuthUsageDisabledResult()
      }
      if (candidate.localId) {
        return fetchInactiveClaudeAccountUsage(
          { id: candidate.localId },
          { networkProxySettings: settings, signal }
        )
      }
      // The machine's own login: read its token from the folder its identity was read from.
      const router = manager.deps.services.claudeRuntimeAuth.router
      return fetchActiveClaudeRateLimits({
        networkProxySettings: settings,
        signal,
        authPreparation: {
          configDir: router.systemDefaultHome(),
          envPatch: {},
          provenance: 'system'
        }
      })
    }
    const home = candidate.localId ? manager.codexHome(candidate.localId) : undefined
    if (home === null) {
      // Reading the default home here would report another account's usage as this one's.
      throw new Error(`No CODEX_HOME for ${candidate.label}`)
    }
    return fetchCodexRateLimits({
      codexHomePath: home,
      networkProxySettings: settings,
      signal,
      preferBackend: true
    })
  }
}
