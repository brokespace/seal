import { RateLimitServiceFetchTargets } from './service-fetch-targets'
import { withoutResetWindows } from './service-result-policy'
import {
  MIN_REFETCH_MS,
  normalizeClaudeConfigDir,
  type ActiveRateLimitProvider
} from './service-types'
import type { ClaudeRuntimeAuthPreparation } from '../../claude-accounts/runtime-auth/runtime-auth-types'
import type { NormalizedClaudeAccountSelectionTarget } from '../../claude-accounts/selection/runtime-selection'
import type { ProviderRateLimits } from '../../../shared/agent-usage/rate-limits/rate-limit-types'
import { claudeOAuthUsageDisabledResult } from '../providers/claude/claude-usage-result'
import { readUserClaudeConfigDir } from '../../claude-accounts/profiles/claude-profile-paths'
import { getClaudeProfileRouter } from '../../claude-accounts/profiles/routing/claude-profile-installed-router'

export abstract class RateLimitServiceFetchPolicy extends RateLimitServiceFetchTargets {
  protected isClaudeOAuthUsageEnabled(): boolean {
    return this.claudeOAuthUsageEnabledResolver?.() ?? true
  }

  protected claudeUsageFetchSignal(signal: AbortSignal): AbortSignal {
    return AbortSignal.any([signal, this.claudeUsageAbortController.signal])
  }

  protected claudeUsageWithoutOAuth(): ProviderRateLimits {
    const live = this.liveClaudeUsage ? withoutResetWindows(this.liveClaudeUsage, Date.now()) : null
    return live?.session || live?.weekly ? live : claudeOAuthUsageDisabledResult()
  }

  protected getMiniMaxCredentialError(message: string): ProviderRateLimits {
    return {
      provider: 'minimax',
      session: null,
      weekly: null,
      updatedAt: Date.now(),
      error: message,
      status: 'error',
      usageMetadata: { failureKind: 'keychain-unavailable', source: 'web' }
    }
  }

  protected getZcodePlanCredentialError(message: string): ProviderRateLimits {
    return {
      provider: 'zcode',
      session: null,
      weekly: null,
      monthly: null,
      updatedAt: Date.now(),
      error: message,
      status: 'error',
      usageMetadata: { failureKind: 'keychain-unavailable', source: 'web' }
    }
  }

  protected claudeStateAtCycleStart(limits: ProviderRateLimits | null): ProviderRateLimits {
    return this.isClaudeOAuthUsageEnabled()
      ? this.withFetchingStatus(limits, 'claude')
      : this.claudeUsageWithoutOAuth()
  }

  // Retry-After remains binding even when live posts restore ok display; early polls waste budget and prolong 429s.
  protected isRetryAfterActive(limits: ProviderRateLimits | null): boolean {
    return Boolean(limits?.usageMetadata?.retryAtMs && limits.usageMetadata.retryAtMs > Date.now())
  }

  // A live receipt preserves display, not proof of selected-account freshness.
  protected isLiveClaudeUsageFresh(limits: ProviderRateLimits | null): boolean {
    return Boolean(
      limits?.status === 'ok' &&
      limits.usageMetadata?.source === 'live-session' &&
      Date.now() - limits.updatedAt < MIN_REFETCH_MS
    )
  }

  // Claude's Retry-After and agy's sign-in hold bind automated checks; user refreshes may pass.
  protected shouldSkipAutomatedFetch(
    provider: ActiveRateLimitProvider,
    limits: ProviderRateLimits | null
  ): boolean {
    return (provider === 'claude' || provider === 'antigravity') && this.isRetryAfterActive(limits)
  }

  protected resolveClaudeFetchApply(
    fresh: ProviderRateLimits,
    previous: ProviderRateLimits | null,
    provenance: string
  ): ProviderRateLimits {
    if (!this.isClaudeOAuthUsageEnabled()) {
      return this.claudeUsageWithoutOAuth()
    }
    this.lastClaudeCheckCompletedAt = fresh.updatedAt
    return (
      this.liveClaudeUsageOverFailedCheck(fresh, this.state.claude) ??
      this.applyAccountReading(`claude:${provenance}`, fresh, previous)
    )
  }

  // Failed OAuth must preserve newer live display while forwarding Retry-After to the poll gate.
  protected liveClaudeUsageOverFailedCheck(
    fresh: ProviderRateLimits,
    current: ProviderRateLimits | null
  ): ProviderRateLimits | null {
    if (fresh.status === 'ok' || !current || !this.isLiveClaudeUsageFresh(current)) {
      return null
    }
    const retryAtMs = fresh.usageMetadata?.retryAtMs
    return retryAtMs
      ? { ...current, usageMetadata: { ...current.usageMetadata, retryAtMs } }
      : current
  }

  protected rememberClaudeAuthSnapshot(
    authPreparation: ClaudeRuntimeAuthPreparation | undefined,
    claudeGeneration: number,
    claudeTarget: NormalizedClaudeAccountSelectionTarget
  ): void {
    // A switch during resolver await invalidates attribution; never restore the outgoing configDir.
    if (
      claudeGeneration !== this.claudeFetchGeneration ||
      !this.isSameClaudeTarget(claudeTarget, this.claudeFetchTarget)
    ) {
      return
    }
    const snapshot = {
      // System Default uses the user config folder without injecting a managed one.
      configDir: normalizeClaudeConfigDir(
        authPreparation?.envPatch.CLAUDE_CONFIG_DIR ??
          getClaudeProfileRouter()?.userConfigDir() ??
          readUserClaudeConfigDir(process.env)
      ),
      home: authPreparation?.configDir,
      provenance: authPreparation?.provenance ?? 'system'
    }
    if (
      snapshot.configDir !== this.lastClaudeAuthSnapshot?.configDir ||
      snapshot.provenance !== this.lastClaudeAuthSnapshot?.provenance
    ) {
      this.liveClaudeUsage = null
    }
    this.lastClaudeAuthSnapshot = snapshot
  }
}
