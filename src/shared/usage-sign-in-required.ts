import type { ProviderRateLimits } from './rate-limit-types'

const CONFIRMED_SIGN_OUT_PATTERNS = [
  /\bnot signed in\b/i,
  /\bnot logged in\b/i,
  /\blogged out\b/i,
  /\bauthentication required\b/i,
  /\b(?:sign|log)[ -]?in required\b/i,
  /\bplease (?:sign|log) in\b/i,
  /\bplease reauthenticate\b/i
]

/**
 * Whether a usage reading proves the login needs a new sign-in. A lapsed token, a throttled or
 * failed usage check and a network error are not that: the login still works.
 */
export function isUsageSignInRequired(
  limits: Pick<ProviderRateLimits, 'error' | 'usageMetadata'>
): boolean {
  if (limits.usageMetadata?.failureKind === 'missing-credentials') {
    return true
  }
  // Auth wording may describe a refresh/network failure; only proven sign-out warrants a sign-in CTA.
  if (limits.usageMetadata?.failureKind) {
    return false
  }
  const error = limits.error
  return Boolean(error && CONFIRMED_SIGN_OUT_PATTERNS.some((pattern) => pattern.test(error)))
}
