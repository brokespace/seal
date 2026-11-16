import type { ClaudeStatusLineRateLimits } from '../../../shared/agent-usage/rate-limits/claude-statusline-rate-limits'
import type { ProviderRateLimits } from '../../../shared/agent-usage/rate-limits/rate-limit-types'
import {
  liveClaudeReading,
  mergeLiveClaudeUsageWindows,
  repeatsLiveClaudeReading
} from './live-claude-usage-windows'
import { withoutResetWindows } from './service-result-policy'
import { RateLimitServiceInactiveAccounts } from './service-inactive-accounts'
import { normalizeClaudeConfigDir } from './service-types'

/** Whose usage a session reports when it does not run in the selected account's own folder. */
export type LiveClaudeUsageOwner =
  | { kind: 'selected' }
  | { kind: 'account'; accountId: string }
  | { kind: 'system'; identity: string }

export type LiveClaudeUsageOwnerResolver = (
  event: ClaudeStatusLineRateLimits
) => LiveClaudeUsageOwner | null

/** Running sessions report their account's usage each turn; every account's reading takes it. */
export abstract class RateLimitServiceLiveClaudeUsage extends RateLimitServiceInactiveAccounts {
  private liveClaudeUsageOwnerResolver: LiveClaudeUsageOwnerResolver | null = null

  setLiveClaudeUsageOwnerResolver(resolver: LiveClaudeUsageOwnerResolver | null): void {
    this.liveClaudeUsageOwnerResolver = resolver
  }

  ingestLiveClaudeRateLimits(event: ClaudeStatusLineRateLimits): void {
    const snapshot = this.lastClaudeAuthSnapshot
    const inSelectedFolder =
      snapshot !== null && normalizeClaudeConfigDir(event.configDir) === snapshot.configDir
    const owner = inSelectedFolder
      ? ({ kind: 'selected' } as const)
      : (this.liveClaudeUsageOwnerResolver?.(event) ?? null)
    if (!owner) {
      // Different accounts/runtimes report their own quota; never guess whose it is.
      console.debug('[rate-limits] dropped live Claude usage: no account owns its folder', {
        eventConfigDir: event.configDir,
        snapshotConfigDir: snapshot?.configDir
      })
      return
    }
    if (owner.kind === 'account') {
      this.ingestInactiveLiveClaudeUsage(owner.accountId, event)
    } else if (owner.kind === 'system') {
      this.ingestSystemLiveClaudeUsage(owner.identity, event)
    } else if (snapshot) {
      // Without a selected-account snapshot the post has no provenance to carry.
      this.ingestSelectedLiveClaudeUsage(snapshot, event)
    }
  }

  private ingestSelectedLiveClaudeUsage(
    snapshot: { home: string | undefined; provenance: string },
    event: ClaudeStatusLineRateLimits
  ): void {
    const previous = this.state.claude
    const now = Date.now()
    const windows = mergeLiveClaudeUsageWindows(previous, event, now)
    if (!windows) {
      return
    }
    const priorLive = this.liveClaudeUsage ? withoutResetWindows(this.liveClaudeUsage, now) : null
    this.liveClaudeUsage = {
      provider: 'claude',
      session: windows.freshSession ?? priorLive?.session ?? null,
      weekly: windows.freshWeekly ?? priorLive?.weekly ?? null,
      updatedAt: now,
      error: null,
      status: 'ok',
      usageMetadata: {
        source: 'live-session',
        lastSuccessfulSource: 'live-session',
        authProvenance: snapshot.provenance
      }
    }
    this.rememberUsageReadingAccount(
      'claude',
      this.claudeFetchTarget,
      snapshot.home,
      snapshot.provenance
    )
    if (repeatsLiveClaudeReading(previous, windows, now)) {
      return
    }
    this.activeFailureStreakByProvider.claude = 0
    const next = liveClaudeReading(previous, windows, snapshot.provenance, now)
    this.keptReadings?.keep(`claude:${snapshot.provenance}`, next)
    this.updateState({ ...this.state, claude: next })
  }

  private liveReadingOver(
    previous: ProviderRateLimits | null,
    event: ClaudeStatusLineRateLimits,
    provenance: string
  ): ProviderRateLimits | null {
    const now = Date.now()
    const windows = mergeLiveClaudeUsageWindows(previous, event, now)
    return windows && !repeatsLiveClaudeReading(previous, windows, now)
      ? liveClaudeReading(previous, windows, provenance, now)
      : null
  }

  private ingestInactiveLiveClaudeUsage(
    accountId: string,
    event: ClaudeStatusLineRateLimits
  ): void {
    if (!this.isCurrentInactiveClaudeAccount(accountId)) {
      return
    }
    const provenance = `profile:${accountId}`
    const next = this.liveReadingOver(
      this.inactiveClaudeCache.get(accountId) ?? null,
      event,
      provenance
    )
    if (!next) {
      return
    }
    this.inactiveClaudeCache.set(accountId, next)
    this.keptReadings?.keep(`claude:${provenance}`, next)
    this.pushToRenderer()
  }

  private ingestSystemLiveClaudeUsage(identity: string, event: ClaudeStatusLineRateLimits): void {
    const kept = this.systemLoginUsage.claude
    const sameLogin = kept?.identity === identity
    const next = this.liveReadingOver(sameLogin ? kept.rateLimits : null, event, 'system')
    if (!next) {
      return
    }
    this.systemLoginUsage.claude = {
      identity,
      rateLimits: next,
      isFetching: sameLogin && kept.isFetching
    }
    this.keptReadings?.keep('claude:system', next, identity)
    this.pushToRenderer()
  }
}
