import type { ProviderRateLimits } from '../../../shared/agent-usage/rate-limits/rate-limit-types'
import { getClaudeProfileRouter } from '../../claude-accounts/profiles/routing/claude-profile-installed-router'
import { fetchActiveClaudeRateLimits } from '../providers/claude/claude-active-usage-fetch'
import { fetchCodexRateLimits } from '../providers/codex/codex-fetcher'
import { RateLimitServiceLiveClaudeUsage } from './service-live-claude-usage'

/** Reads of one unselected account for a caller that keeps its own cadence (Seal's swap poller). */
export abstract class RateLimitServiceAccountReads extends RateLimitServiceLiveClaudeUsage {
  private systemLoginRead: Partial<Record<'claude' | 'codex', Promise<void>>> = {}

  /**
   * The machine's own login while another account is the host's selection, read from its own
   * home into `systemLoginUsage`. `identity` names the login the caller saw there; a reading
   * kept for another identity is dropped. An automatic read: Retry-After and the shared
   * per-account budget hold.
   */
  async readSystemLoginUsage(
    provider: 'claude' | 'codex',
    identity: string,
    options: { preferBackend?: boolean } = {}
  ): Promise<ProviderRateLimits | null> {
    const claudeHome = getClaudeProfileRouter()?.systemDefaultHome()
    // Without the login's own home, a read would report whichever account is selected.
    if (provider === 'claude' && (!this.isClaudeOAuthUsageEnabled() || !claudeHome)) {
      return null
    }
    await this.systemLoginRead[provider]
    const slot = `${provider}:system`
    if (this.systemLoginUsage[provider] && this.systemLoginUsage[provider].identity !== identity) {
      this.accountReads.forget(slot)
    }
    const reading = (): ProviderRateLimits | null => {
      const kept = this.systemLoginUsage[provider]
      return kept?.identity === identity ? kept.rateLimits : null
    }
    const cached = reading()
    if (this.isRetryAfterActive(cached) || !this.accountReads.admit(slot, Date.now())) {
      return cached
    }
    const controller = this.beginFetchCycle()
    this.systemLoginUsage[provider] = { identity, rateLimits: cached, isFetching: true }
    this.pushToRenderer()
    const read = (async () => {
      let applied: ProviderRateLimits | null = null
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
          // The login's own sessions may have reported while the request was out.
          const current = reading()
          const keptKey =
            provider === 'claude'
              ? 'claude:system'
              : `codex:${this.getCodexProvenance({ runtime: 'host', wslDistro: null }, null)}`
          applied =
            (provider === 'claude' ? this.liveClaudeUsageOverFailedCheck(fresh, current) : null) ??
            this.applyAccountReading(keptKey, fresh, current, identity)
          this.accountReads.settle(slot, fresh.status !== 'error')
        }
      } catch {
        this.accountReads.settle(slot, false)
      } finally {
        this.systemLoginRead[provider] = undefined
        this.systemLoginUsage[provider] = {
          identity,
          rateLimits: applied ?? reading(),
          isFetching: false
        }
        this.finishFetchCycle(controller)
        this.pushToRenderer()
      }
    })()
    this.systemLoginRead[provider] = read
    await read
    return this.systemLoginUsage[provider]?.rateLimits ?? null
  }

  /**
   * One inactive Claude account read into the shared cache. Serves the cached reading while the
   * shared per-account budget or its Retry-After holds.
   */
  protected async readInactiveClaudeAccount(accountId: string): Promise<ProviderRateLimits | null> {
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
    if (!this.admitsInactiveRead('claude', accountId)) {
      return this.inactiveClaudeCache.get(accountId) ?? null
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
    options: { preferBackend?: boolean } = {}
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
    if (!this.admitsInactiveRead('codex', accountId)) {
      return this.inactiveCodexCache.get(accountId) ?? null
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
