import { createHash } from 'node:crypto'
import type { ClaudeBillingSignals } from '../../../../shared/claude-account-billing'
import { abortSignalWithTimeout } from '../../../lib/abort-signal-with-timeout'
import { getMainHttpClient } from '../../../network/http-client'

const OAUTH_PROFILE_URL = 'https://api.anthropic.com/api/oauth/profile'
const API_TIMEOUT_MS = 10_000
// A plan changes rarely; a miss is retried sooner so one bad response does not stick.
const KNOWN_TTL_MS = 12 * 60 * 60 * 1000
const UNKNOWN_TTL_MS = 15 * 60 * 1000
const MAX_CACHED_LOGINS = 64

type OAuthProfileResponse = {
  organization?: {
    organization_type?: unknown
    rate_limit_tier?: unknown
    billing_type?: unknown
  } | null
}

const cache = new Map<string, { signals: ClaudeBillingSignals | null; expiresAt: number }>()

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function claudeBillingSignalsFromProfile(profile: unknown): ClaudeBillingSignals | null {
  const organization = (profile as OAuthProfileResponse | null)?.organization
  if (!organization || typeof organization !== 'object') {
    return null
  }
  const signals: ClaudeBillingSignals = {
    organizationType: text(organization.organization_type),
    rateLimitTier: text(organization.rate_limit_tier),
    billingType: text(organization.billing_type)
  }
  return signals.organizationType || signals.rateLimitTier || signals.billingType ? signals : null
}

/**
 * The organization a login belongs to, from the profile endpoint Claude Code itself reads at
 * sign-in. Read only; a failure is "unknown", never an error for the caller.
 */
export async function fetchClaudeOAuthProfileBilling(
  token: string,
  signal?: AbortSignal
): Promise<ClaudeBillingSignals | null> {
  const key = createHash('sha256').update(token).digest('hex')
  const cached = cache.get(key)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.signals
  }
  let signals: ClaudeBillingSignals | null = null
  try {
    const response = await getMainHttpClient().fetch(OAUTH_PROFILE_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': 'claude-code/2.1.0'
      },
      signal: abortSignalWithTimeout(signal, API_TIMEOUT_MS)
    })
    if (response.ok) {
      signals = claudeBillingSignalsFromProfile(await response.json())
    } else {
      await response.body?.cancel().catch(() => {})
    }
  } catch {
    signals = null
  }
  if (signal?.aborted) {
    return signals
  }
  if (cache.size >= MAX_CACHED_LOGINS) {
    cache.delete(cache.keys().next().value as string)
  }
  cache.set(key, {
    signals,
    expiresAt: Date.now() + (signals ? KNOWN_TTL_MS : UNKNOWN_TTL_MS)
  })
  return signals
}

export function resetClaudeOAuthProfileCacheForTests(): void {
  cache.clear()
}
