import type { ProviderRateLimits } from '../../../shared/rate-limit-types'
import { getClaudeProfileRouter } from '../../claude-accounts/profiles/routing/claude-profile-installed-router'
import { fetchActiveClaudeRateLimits } from '../providers/claude/claude-active-usage-fetch'
import { fetchCodexRateLimits } from '../providers/codex/codex-fetcher'
import { RateLimitServiceInactiveAccounts } from './service-inactive-accounts'

/** Whether a good reading is young enough to serve again without another request. */
function isRecentReading(
  limits: ProviderRateLimits | null,
  notWithinMs: number | undefined
): boolean {
  return (
    notWithinMs !== undefined &&
    limits?.status === 'ok' &&
    Date.now() - limits.updatedAt < notWithinMs
  )
}

/** Reads of one unselected account for a caller that keeps its own cadence (Seal's swap poller). */
export abstract class RateLimitServiceAccountReads extends RateLimitServiceInactiveAccounts {
  private systemLoginRead: Partial<Record<'claude' | 'codex', Promise<void>>> = {}

  /**
   * The machine's own login while another account is the host's selection, read from its own
   * home into `systemLoginUsage`. `identity` names the login the caller saw there; a reading
   * kept for another identity is dropped. An automatic read: Retry-After and `notWithinMs` hold.
   */
  async readSystemLoginUsage(
    provider: 'claude' | 'codex',
    identity: string,
    options: { notWithinMs?: number; preferBackend?: boolean } = {}
  ): Promise<ProviderRateLimits | null> {
    const claudeHome = getClaudeProfileRouter()?.systemDefaultHome()
    // Without the login's own home, a read would report whichever account is selected.
    if (provider === 'claude' && (!this.isClaudeOAuthUsageEnabled() || !claudeHome)) {
      return null
    }
    await this.systemLoginRead[provider]
    const kept = this.systemLoginUsage[provider]
    const cached = kept?.identity === identity ? kept.rateLimits : null
    if (this.isRetryAfterActive(cached) || isRecentReading(cached, options.notWithinMs)) {
      return cached
    }
    const controller = this.beginFetchCycle()
    this.systemLoginUsage[provider] = { identity, rateLimits: cached, isFetching: true }
    this.pushToRenderer()
    const read = (async () => {
      let next = cached
      try {
        const networkProxySettings = this.networkProxySettingsResolver?.()
        const fresh =
          provider === 'claude' && claudeHome
            ? await fetchActiveClaudeRateLimits({
                networkProxySettings,
                signal: this.claudeUsageFetchSignal(controller.signal),
                authPreparation: { configDir: claudeHome, envPatch: {}, provenance: 'system' }
              })
            : await fetchCodexRateLimits({
                networkProxySettings,
                signal: controller.signal,
                preferBackend: options.preferBackend
              })
        if (!controller.signal.aborted) {
          next = this.applyStalePolicy(fresh, cached)
        }
      } catch {
        // The reading kept so far stands.
      } finally {
        this.systemLoginRead[provider] = undefined
        this.systemLoginUsage[provider] = { identity, rateLimits: next, isFetching: false }
        this.finishFetchCycle(controller)
        this.pushToRenderer()
      }
    })()
    this.systemLoginRead[provider] = read
    await read
    return this.systemLoginUsage[provider]?.rateLimits ?? null
  }

  /**
   * One inactive Claude account read into the shared cache. Serves the cached reading while it
   * is younger than `notWithinMs` or its Retry-After still binds.
   */
  protected async readInactiveClaudeAccount(
    accountId: string,
    options: { notWithinMs?: number } = {}
  ): Promise<ProviderRateLimits | null> {
    if (!this.isClaudeOAuthUsageEnabled()) {
      return null
    }
    while (this.inactiveClaudeFetching.size > 0) {
      await this.inactiveReadsIdle()
    }
    const account = (this.inactiveClaudeAccountsResolver?.() ?? []).find(
      (entry) => entry.id === accountId
    )
    if (!account) {
      return null
    }
    const cached = this.inactiveClaudeCache.get(accountId) ?? null
    if (this.isRetryAfterActive(cached) || isRecentReading(cached, options.notWithinMs)) {
      return cached
    }
    const controller = this.beginFetchCycle()
    this.inactiveClaudeFetching.add(accountId)
    this.pushToRenderer()
    try {
      await this.readInactiveClaude(
        account,
        this.claudeUsageFetchSignal(controller.signal),
        this.inactiveClaudeAccountsGeneration
      )
    } finally {
      this.finishFetchCycle(controller)
      this.releaseInactiveReadWaiters()
    }
    return this.inactiveClaudeCache.get(accountId) ?? null
  }

  /** The Codex counterpart of `readInactiveClaudeAccount`. */
  protected async readInactiveCodexAccount(
    accountId: string,
    options: { notWithinMs?: number; preferBackend?: boolean } = {}
  ): Promise<ProviderRateLimits | null> {
    while (this.inactiveCodexFetchInFlight) {
      await this.inactiveReadsIdle()
    }
    const account = (this.inactiveCodexAccountsResolver?.() ?? []).find(
      (entry) => entry.id === accountId
    )
    if (!account) {
      return null
    }
    const cached = this.inactiveCodexCache.get(accountId) ?? null
    if (this.isRetryAfterActive(cached) || isRecentReading(cached, options.notWithinMs)) {
      return cached
    }
    const controller = this.beginFetchCycle()
    this.inactiveCodexFetchInFlight = true
    try {
      await this.readInactiveCodex(
        account,
        controller.signal,
        this.inactiveCodexAccountsGeneration,
        options.preferBackend
      )
    } finally {
      this.inactiveCodexFetchInFlight = false
      this.finishFetchCycle(controller)
      this.releaseInactiveReadWaiters()
    }
    return this.inactiveCodexCache.get(accountId) ?? null
  }
}
