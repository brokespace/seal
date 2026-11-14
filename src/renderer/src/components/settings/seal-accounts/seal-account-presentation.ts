import type { Translate } from '@/i18n/use-translate'
import { formatResetDuration } from '../../../../../shared/rate-limit-reset-format'
import type {
  SealAccountCandidate,
  SealAccountHealth
} from '../../../../../shared/seal-accounts/seal-account-candidates'
import type { SealAccountGroup } from '../../../../../shared/seal-accounts/seal-fleet-overview'

export type SealHealthTone = 'ok' | 'warning' | 'dead'

export function sealHealthTone(health: SealAccountHealth | undefined): SealHealthTone {
  if (health?.state === 'dead') {
    return 'dead'
  }
  return health?.state === 'expiring' ? 'warning' : 'ok'
}

function formatDay(at: number): string {
  return new Date(at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Short text for a login that needs attention, e.g. "Expires Mar 3, 2027"; null while it is healthy. */
export function sealHealthLabel(
  health: SealAccountHealth | undefined,
  t: Translate
): string | null {
  if (!health || health.state === 'ok') {
    return null
  }
  if (health.state === 'expiring') {
    return t('seal.accounts.health.expiring', 'Expires {{value0}}', {
      value0: formatDay(health.expiresAt)
    })
  }
  switch (health.reason) {
    case 'signed-out':
      return t('seal.accounts.health.signedOut', 'Signed out')
    case 'rejected':
      return t('seal.accounts.health.rejected', 'Login rejected')
    case 'expired':
      return t('seal.accounts.health.expired', 'Expired')
    case 'missing-secret':
      return t('seal.accounts.health.missingSecret', 'Secret missing')
  }
}

export type SealAccountNotice = {
  label: string
  tone: SealHealthTone
  state: 'rate-limited' | 'expiring' | 'dead'
}

/**
 * The one status an account card shows, or null when there is nothing to say. A healthy login
 * shows nothing; "rate limited" appears only while the account is out of quota.
 */
export function sealAccountNotice(
  candidate: Pick<SealAccountCandidate, 'health' | 'rateLimit'>,
  now: number,
  t: Translate
): SealAccountNotice | null {
  const label = sealHealthLabel(candidate.health, t)
  if (label !== null && candidate.health && candidate.health.state !== 'ok') {
    return { label, tone: sealHealthTone(candidate.health), state: candidate.health.state }
  }
  const limit = candidate.rateLimit
  if (!limit) {
    return null
  }
  return {
    label:
      limit.resetsAt !== null && limit.resetsAt > now
        ? t('seal.accounts.health.rateLimitedUntil', 'Rate limited · resets in {{value0}}', {
            value0: formatResetDuration(limit.resetsAt - now)
          })
        : t('seal.accounts.health.rateLimited', 'Rate limited'),
    tone: 'warning',
    state: 'rate-limited'
  }
}

/** What the person should do about an account that cannot run, or null when it is healthy. */
export function sealHealthAdvice(candidate: SealAccountCandidate, t: Translate): string | null {
  const health = candidate.health
  if (!health || health.state === 'ok') {
    return null
  }
  if (health.state === 'expiring') {
    return candidate.credential === 'setup-token'
      ? t(
          'seal.accounts.health.advice.tokenExpiring',
          'Setup tokens last one year. Paste a new one before this one runs out.'
        )
      : t(
          'seal.accounts.health.advice.loginExpiring',
          'This login cannot renew itself. Sign in again before it runs out.'
        )
  }
  if (health.reason === 'missing-secret') {
    return t(
      'seal.accounts.health.advice.missingSecret',
      'This computer’s keychain no longer holds the secret. Remove it and add it again.'
    )
  }
  return candidate.credential === 'setup-token'
    ? t(
        'seal.accounts.health.advice.tokenDead',
        'The provider no longer accepts this token. Remove it and paste a new one.'
      )
    : t(
        'seal.accounts.health.advice.loginDead',
        'The provider no longer accepts this login. Sign in again to keep using it.'
      )
}

export function sealGroupTitle(group: SealAccountGroup, t: Translate): string {
  switch (group) {
    case 'claude':
      return t('seal.accounts.group.claude', 'Claude')
    case 'codex':
      return t('seal.accounts.group.codex', 'Codex')
    case 'apiKeys':
      return t('seal.accounts.group.apiKeys', 'API keys')
  }
}

export function sealGroupDescription(group: SealAccountGroup, t: Translate): string {
  switch (group) {
    case 'claude':
      return t(
        'seal.accounts.group.claudeDescription',
        'Claude subscriptions for Claude Code. The first working account in the list is preferred.'
      )
    case 'codex':
      return t(
        'seal.accounts.group.codexDescription',
        'ChatGPT logins for Codex. The first working account in the list is preferred.'
      )
    case 'apiKeys':
      return t(
        'seal.accounts.group.apiKeysDescription',
        'Pay-as-you-go Anthropic and OpenAI keys, sealed in this computer’s keychain. Used when a rule picks one or as a fallback.'
      )
  }
}

/** How a login is billed, where its plan badge does not already say: null for keys and named plans. */
export function sealLoginBillingBadge(
  candidate: SealAccountCandidate,
  t: Translate
): { label: string; hint: string } | null {
  if (candidate.kind === 'api-key') {
    return null
  }
  if (candidate.billing === 'api') {
    return {
      label: t('seal.accounts.badge.apiBilling', 'API billing'),
      hint: t(
        'seal.accounts.badge.apiBillingHint',
        'This login belongs to a Console organization that pays per token.'
      )
    }
  }
  if (candidate.billing === 'subscription' && !candidate.plan) {
    return {
      label: t('seal.accounts.badge.subscription', 'Subscription'),
      hint: t(
        'seal.accounts.badge.subscriptionHint',
        'This login runs on a plan seat, not on API usage.'
      )
    }
  }
  return null
}

/** The line under the account name: who it signs in as and where. */
export function sealAccountIdentity(candidate: SealAccountCandidate, t: Translate): string {
  if (candidate.credential === 'setup-token') {
    return t('seal.accounts.identity.setupToken', 'Claude setup token')
  }
  if (candidate.kind === 'api-key') {
    return candidate.provider === 'claude'
      ? t('seal.accounts.identity.anthropicKey', 'Anthropic API key')
      : t('seal.accounts.identity.openaiKey', 'OpenAI API key')
  }
  const email = candidate.email && candidate.email !== candidate.label ? candidate.email : null
  return [email, candidate.orgName].filter(Boolean).join(' · ')
}
