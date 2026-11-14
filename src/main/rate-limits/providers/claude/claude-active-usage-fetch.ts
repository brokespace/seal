import type { ProviderRateLimits } from '../../../../shared/rate-limit-types'
import {
  classifyClaudeBilling,
  mergeClaudeBillingSignals,
  type ClaudeBillingSignals
} from '../../../../shared/claude-account-billing'
import {
  readClaudeOAuthCredentials,
  type ClaudeOAuthCredentialReadResult,
  resolveClaudeOAuthCredentialReadOptions
} from './claude-oauth-credentials'
import { fetchClaudeOAuthUsage } from './claude-oauth-usage-request'
import { classifyClaudeOAuthUsageError } from './claude-usage-error-classification'
import { OAuthUsageError } from './claude-oauth-usage-error'
import type { ClaudeRateLimitFetchOptions } from './claude-usage-fetch-options'
import { abortedClaudeRateLimitResult, makeClaudeUsageResult } from './claude-usage-result'
import { CLAUDE_PROFILE_MISSING_MESSAGE } from '../../../../shared/claude-profile-routing'
import { fetchClaudeOAuthProfileBilling } from './claude-oauth-profile-request'
import { readClaudeStateBilling } from './claude-state-billing'
import { getClaudeProfileRouter } from '../../../claude-accounts/profiles/routing/claude-profile-installed-router'
import { readUserClaudeConfigDir } from '../../../claude-accounts/profiles/claude-profile-paths'

export const CLAUDE_API_KEY_BILLING_MESSAGE = 'No subscription plan — API key billing'
export const CLAUDE_LOGIN_UNREADABLE_MESSAGE =
  "Seal cannot read this login's token, so its usage is unknown."

function withBilling(
  limits: ProviderRateLimits,
  signals: ClaudeBillingSignals
): ProviderRateLimits {
  const billing = classifyClaudeBilling(signals)
  return {
    ...limits,
    ...(billing.label ? { planType: billing.label } : {}),
    ...(billing.kind ? { billing: billing.kind } : {})
  }
}

/** The plan fields saved at sign-in, topped up from the login's organization when they name no plan. */
async function tokenBillingSignals(
  credentials: ClaudeOAuthCredentialReadResult & { token: string },
  signal: AbortSignal | undefined
): Promise<ClaudeBillingSignals> {
  const saved = credentials.billing ?? {}
  if (classifyClaudeBilling(saved).plan) {
    return saved
  }
  return mergeClaudeBillingSignals(
    await fetchClaudeOAuthProfileBilling(credentials.token, signal),
    saved
  )
}

/** Usage observes the account; only a user-started Claude process may refresh its login. */
export async function fetchActiveClaudeRateLimits(
  options?: ClaudeRateLimitFetchOptions
): Promise<ProviderRateLimits> {
  const usageError = options?.authPreparation?.usageError
  if (usageError) {
    return makeClaudeUsageResult('error', usageError, {
      failureKind:
        usageError === CLAUDE_PROFILE_MISSING_MESSAGE ? 'missing-credentials' : 'usage-unavailable',
      attemptedSources: []
    })
  }
  if (options?.signal?.aborted) {
    return abortedClaudeRateLimitResult()
  }
  const credentials = await readClaudeOAuthCredentials(
    resolveClaudeOAuthCredentialReadOptions(options?.authPreparation)
  )
  const metadata = {
    credentialSource: credentials.source,
    authProvenance: options?.authPreparation?.provenance ?? 'system'
  }
  // System Default without login may be an API-key/non-Claude user, not a signed-out account.
  if (
    !credentials.token &&
    !credentials.unavailable &&
    !credentials.hasRefreshableCredentials &&
    metadata.authProvenance === 'system'
  ) {
    const state = await readClaudeStateBilling(
      getClaudeProfileRouter()?.userConfigDir() ?? readUserClaudeConfigDir(process.env)
    )
    const billing = classifyClaudeBilling(state.signals)
    // A signed-in login whose token Seal cannot find is not thereby an API key.
    if (state.signedIn && billing.kind !== 'api') {
      return withBilling(
        makeClaudeUsageResult('unavailable', CLAUDE_LOGIN_UNREADABLE_MESSAGE, {
          ...metadata,
          failureKind: 'usage-unavailable',
          attemptedSources: []
        }),
        state.signals
      )
    }
    return withBilling(
      makeClaudeUsageResult('unavailable', CLAUDE_API_KEY_BILLING_MESSAGE, {
        ...metadata,
        failureKind: 'missing-credentials',
        attemptedSources: []
      }),
      state.signals
    )
  }
  if (!credentials.token) {
    return makeClaudeUsageResult(
      'error',
      credentials.unavailable
        ? 'Claude usage is unavailable.'
        : 'Sign in again to use this account.',
      {
        ...metadata,
        failureKind: credentials.unavailable ? 'keychain-unavailable' : 'missing-credentials',
        attemptedSources: []
      }
    )
  }
  try {
    const usage = await fetchClaudeOAuthUsage(credentials.token, options?.signal)
    return withBilling(
      usage,
      await tokenBillingSignals({ ...credentials, token: credentials.token }, options?.signal)
    )
  } catch (error) {
    const { failureKind } = classifyClaudeOAuthUsageError(error)
    if (failureKind === 'stale-token' && !canClaudeRenewLogin(credentials, error)) {
      return makeClaudeUsageResult('error', 'Sign in again to use this account.', {
        ...metadata,
        failureKind: 'missing-credentials',
        attemptedSources: ['oauth']
      })
    }
    // Retain both the 429 polling delay and its user-visible cause.
    const retryAfterMs = error instanceof OAuthUsageError ? error.retryAfterMs : null
    return withBilling(
      makeClaudeUsageResult(
        'error',
        failureKind === 'stale-token'
          ? // Idle login's access token lapsed, not the login; Claude refreshes it when it next runs.
            'Claude usage updates the next time Claude runs.'
          : (failureKind === 'rate-limited' || failureKind === 'missing-scope') &&
              error instanceof OAuthUsageError
            ? error.message
            : 'Claude usage is unavailable.',
        {
          ...metadata,
          failureKind,
          attemptedSources: ['oauth'],
          ...(retryAfterMs ? { retryAtMs: Date.now() + retryAfterMs } : {})
        }
      ),
      credentials.billing ?? {}
    )
  }
}

// Mirrors Claude Code's own refreshability check; anything else needs a new sign-in.
function canClaudeRenewLogin(
  credentials: ClaudeOAuthCredentialReadResult,
  error: unknown
): boolean {
  const refreshTokenExpiresAt = credentials.refreshTokenExpiresAt
  return (
    credentials.hasRefreshableCredentials &&
    (refreshTokenExpiresAt === undefined || refreshTokenExpiresAt > Date.now()) &&
    !(error instanceof OAuthUsageError && /revoked/i.test(error.message))
  )
}
