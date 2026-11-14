import {
  fetchInactiveClaudeAccountUsage,
  type InactiveClaudeAccount
} from '../providers/claude/claude-managed-account-usage'
import { fetchCodexRateLimits } from '../providers/codex/codex-fetcher'
import { RateLimitServicePolling } from './service-polling'
import {
  INACTIVE_CODEX_PROBE_STAGGER_MS,
  INACTIVE_FETCH_DEBOUNCE_MS,
  type InactiveCodexAccountInfo
} from './service-types'
import { delayUnlessAborted } from '../../../shared/abort-aware-delay'

export abstract class RateLimitServiceInactiveAccounts extends RateLimitServicePolling {
  async fetchInactiveClaudeAccountsOnOpen(): Promise<void> {
    if (!this.isClaudeOAuthUsageEnabled()) {
      return
    }
    if (Date.now() - this.lastInactiveClaudeFetchAt < INACTIVE_FETCH_DEBOUNCE_MS) {
      return
    }
    this.pruneInactiveClaudeState()
    if (this.inactiveClaudeFetching.size > 0) {
      return
    }
    const accounts = (this.inactiveClaudeAccountsResolver?.() ?? []).filter(
      (account) => !this.isRetryAfterActive(this.inactiveClaudeCache.get(account.id) ?? null)
    )
    if (accounts.length === 0) {
      return
    }
    const fetchGeneration = this.inactiveClaudeAccountsGeneration
    const controller = this.beginFetchCycle()
    const signal = this.claudeUsageFetchSignal(controller.signal)

    for (const account of accounts) {
      this.inactiveClaudeFetching.add(account.id)
    }
    this.pushToRenderer()

    try {
      for (const account of accounts) {
        await this.readInactiveClaude(account, signal, fetchGeneration)
      }

      if (!signal.aborted && fetchGeneration === this.inactiveClaudeAccountsGeneration) {
        this.lastInactiveClaudeFetchAt = Date.now()
      }
    } finally {
      this.finishFetchCycle(controller)
      this.releaseInactiveReadWaiters()
    }
  }

  /** Reads one inactive Claude account into the cache; the caller has marked it fetching. */
  protected async readInactiveClaude(
    account: InactiveClaudeAccount,
    signal: AbortSignal,
    fetchGeneration: number
  ): Promise<void> {
    const superseded = (): boolean =>
      signal.aborted ||
      fetchGeneration !== this.inactiveClaudeAccountsGeneration ||
      !this.isCurrentInactiveClaudeAccount(account.id)
    const drop = (): void => {
      this.inactiveClaudeFetching.delete(account.id)
      if (!this.isCurrentInactiveClaudeAccount(account.id)) {
        this.inactiveClaudeCache.delete(account.id)
      }
      this.pushToRenderer()
    }
    if (superseded()) {
      drop()
      return
    }
    try {
      const fresh = await fetchInactiveClaudeAccountUsage(account, {
        allowUsagePanelSupplement: this.shouldAllowClaudeUsagePanelSupplement(),
        networkProxySettings: this.networkProxySettingsResolver?.(),
        signal
      })
      if (superseded()) {
        drop()
        return
      }
      const cached = this.inactiveClaudeCache.get(account.id) ?? null
      this.inactiveClaudeCache.set(account.id, this.applyStalePolicy(fresh, cached))
    } catch {
      // Isolate each account's Keychain/network failure so siblings continue.
      if (superseded()) {
        this.inactiveClaudeCache.delete(account.id)
      }
    }
    this.inactiveClaudeFetching.delete(account.id)
    this.pushToRenderer()
  }

  async fetchInactiveCodexAccountsOnOpen(): Promise<void> {
    if (Date.now() - this.lastInactiveCodexFetchAt < INACTIVE_FETCH_DEBOUNCE_MS) {
      return
    }
    this.pruneInactiveCodexState()
    if (this.inactiveCodexFetchInFlight) {
      return
    }
    const accounts = this.inactiveCodexAccountsResolver?.() ?? []
    if (accounts.length === 0) {
      return
    }
    // Switching can activate a previewed account mid-fetch; ignore its stale preview result.
    const fetchGeneration = this.inactiveCodexAccountsGeneration
    const controller = this.beginFetchCycle()
    const signal = controller.signal
    this.inactiveCodexFetchInFlight = true

    let staggerNextProbe = false
    try {
      for (const account of accounts) {
        if (
          signal.aborted ||
          fetchGeneration !== this.inactiveCodexAccountsGeneration ||
          !this.isCurrentInactiveCodexAccount(account.id)
        ) {
          this.inactiveCodexFetching.delete(account.id)
          if (!this.isCurrentInactiveCodexAccount(account.id)) {
            this.inactiveCodexCache.delete(account.id)
          }
          this.pushToRenderer()
          continue
        }
        if (staggerNextProbe) {
          await delayUnlessAborted(INACTIVE_CODEX_PROBE_STAGGER_MS, signal)
          if (
            signal.aborted ||
            fetchGeneration !== this.inactiveCodexAccountsGeneration ||
            !this.isCurrentInactiveCodexAccount(account.id)
          ) {
            this.inactiveCodexFetching.delete(account.id)
            if (!this.isCurrentInactiveCodexAccount(account.id)) {
              this.inactiveCodexCache.delete(account.id)
            }
            this.pushToRenderer()
            continue
          }
        }
        if (await this.readInactiveCodex(account, signal, fetchGeneration)) {
          staggerNextProbe = true
        }
      }

      if (!signal.aborted && fetchGeneration === this.inactiveCodexAccountsGeneration) {
        this.lastInactiveCodexFetchAt = Date.now()
      }
    } finally {
      this.inactiveCodexFetchInFlight = false
      this.finishFetchCycle(controller)
      this.releaseInactiveReadWaiters()
    }
  }

  /** Probes one inactive Codex account's own home into the cache; false when it has no home to read. */
  protected async readInactiveCodex(
    account: InactiveCodexAccountInfo,
    signal: AbortSignal,
    fetchGeneration: number,
    preferBackend = false
  ): Promise<boolean> {
    const superseded = (): boolean =>
      signal.aborted ||
      fetchGeneration !== this.inactiveCodexAccountsGeneration ||
      !this.isCurrentInactiveCodexAccount(account.id)
    const home = await account.resolveHome()
    if (home.kind === 'skip') {
      return false
    }
    this.inactiveCodexFetching.add(account.id)
    this.pushToRenderer()
    try {
      // Read the managed home directly; do not materialize credentials in the shared runtime.
      const fresh = await fetchCodexRateLimits({
        codexHomePath: home.managedHomePath,
        networkProxySettings: this.networkProxySettingsResolver?.(),
        signal,
        preferBackend
      })
      if (superseded()) {
        this.inactiveCodexFetching.delete(account.id)
        if (!this.isCurrentInactiveCodexAccount(account.id)) {
          this.inactiveCodexCache.delete(account.id)
        }
        this.pushToRenderer()
        return true
      }
      const cached = this.inactiveCodexCache.get(account.id) ?? null
      this.inactiveCodexCache.set(account.id, this.applyStalePolicy(fresh, cached))
    } catch {
      // Isolate per-account failures so sibling previews continue.
      if (superseded()) {
        this.inactiveCodexCache.delete(account.id)
      }
    }
    this.inactiveCodexFetching.delete(account.id)
    this.pushToRenderer()
    return true
  }

  private inactiveReadWaiters: (() => void)[] = []

  /** Resolves when the inactive-account pass in flight ends. */
  protected inactiveReadsIdle(): Promise<void> {
    return new Promise((resolve) => {
      this.inactiveReadWaiters.push(resolve)
    })
  }

  protected releaseInactiveReadWaiters(): void {
    const waiters = this.inactiveReadWaiters
    this.inactiveReadWaiters = []
    for (const resolve of waiters) {
      resolve()
    }
  }

  evictInactiveClaudeCache(accountId: string): void {
    this.inactiveClaudeAccountsGeneration += 1
    this.inactiveClaudeCache.delete(accountId)
    this.inactiveClaudeFetching.delete(accountId)
    this.pushToRenderer()
  }

  protected isCurrentInactiveClaudeAccount(accountId: string): boolean {
    return (this.inactiveClaudeAccountsResolver?.() ?? []).some(
      (account) => account.id === accountId
    )
  }

  protected isCurrentInactiveCodexAccount(accountId: string): boolean {
    return (this.inactiveCodexAccountsResolver?.() ?? []).some(
      (account) => account.id === accountId
    )
  }

  protected pruneInactiveClaudeState(): void {
    const currentIds = new Set(
      (this.inactiveClaudeAccountsResolver?.() ?? []).map((account) => account.id)
    )
    for (const accountId of this.inactiveClaudeCache.keys()) {
      if (!currentIds.has(accountId)) {
        this.inactiveClaudeCache.delete(accountId)
      }
    }
    for (const accountId of this.inactiveClaudeFetching) {
      if (!currentIds.has(accountId)) {
        this.inactiveClaudeFetching.delete(accountId)
      }
    }
  }

  protected pruneInactiveCodexState(): void {
    const currentIds = new Set(
      (this.inactiveCodexAccountsResolver?.() ?? []).map((account) => account.id)
    )
    for (const accountId of this.inactiveCodexCache.keys()) {
      if (!currentIds.has(accountId)) {
        this.inactiveCodexCache.delete(accountId)
      }
    }
    for (const accountId of this.inactiveCodexFetching) {
      if (!currentIds.has(accountId)) {
        this.inactiveCodexFetching.delete(accountId)
      }
    }
  }

  evictInactiveCodexCache(accountId: string): void {
    // Clear one account without invalidating sibling fetches/results.
    this.inactiveCodexCache.delete(accountId)
    this.inactiveCodexFetching.delete(accountId)
    this.pushToRenderer()
  }
}
