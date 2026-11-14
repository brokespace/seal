import type { ProviderRateLimits } from '../../../shared/rate-limit-types'
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

/** Reads of one inactive account for a caller that keeps its own cadence (Seal's swap poller). */
export abstract class RateLimitServiceAccountReads extends RateLimitServiceInactiveAccounts {
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
