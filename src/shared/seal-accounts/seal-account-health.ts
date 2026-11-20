import type { SealAccountCandidate, SealAccountHealth } from './seal-account-candidates'

/** `claude setup-token` issues a token that lasts one year. */
export const SETUP_TOKEN_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000
const SETUP_TOKEN_WARNING_MS = 30 * 24 * 60 * 60 * 1000

/** What Seal knows about a stored login without calling the provider. */
export type SealLoginExpiry = {
  /** When the stored access token stops working. */
  expiresAt: number | null
  /** Holds a refresh token, so the provider CLI renews it on its own. */
  refreshable: boolean
  /** Neither renews nor says when it ends: a copied access token that stops working any time. */
  stranded?: boolean
  /** The stored login belongs to another plan than the account it sits under. */
  wrongLogin?: boolean
  /** The account folder names a login but holds no token: Claude itself reports signed out. */
  missing?: boolean
  /** Claude refused the stored refresh token (or it ran out), so only a new sign-in renews it. */
  refreshRejected?: boolean
}

const CLAUDE_PLAN_OF_ORG: Record<string, string> = {
  claude_max: 'max',
  claude_pro: 'pro',
  claude_team: 'team',
  claude_enterprise: 'enterprise'
}

/** False when Claude's stored login is for another plan than the account's organization, e.g. a team login filed under a Max account. */
export function claudeLoginMatchesAccount(
  subscriptionType: string | null,
  organizationType: string | null
): boolean {
  const expected = organizationType ? CLAUDE_PLAN_OF_ORG[organizationType] : undefined
  return !expected || !subscriptionType || subscriptionType === expected
}

/** A login Seal may start or move a session onto: not rejected, signed out, expired or mismatched. */
export function sealLoginUsable(
  candidate: Pick<SealAccountCandidate, 'authFailure' | 'health'>
): boolean {
  return !candidate.authFailure && candidate.health?.state !== 'dead'
}

export type SealHealthInputs = {
  now: number
  /** The provider rejected this login on the last usage read. */
  authFailure: boolean
  /** The account's folder holds no login. */
  needsSignIn: boolean
  /** An API key or setup token whose secret this machine cannot read. */
  missingSecret: boolean
  setupTokenCreatedAt: number | null
  expiry: SealLoginExpiry | null
}

export function sealAccountHealth(inputs: SealHealthInputs): SealAccountHealth {
  if (inputs.missingSecret) {
    return { state: 'dead', reason: 'missing-secret' }
  }
  if (inputs.needsSignIn || inputs.expiry?.missing) {
    return { state: 'dead', reason: 'signed-out' }
  }
  if (inputs.expiry?.refreshRejected) {
    return { state: 'dead', reason: 'expired' }
  }
  if (inputs.authFailure) {
    return { state: 'dead', reason: 'rejected' }
  }
  if (inputs.expiry?.wrongLogin) {
    return { state: 'dead', reason: 'wrong-login' }
  }
  if (inputs.expiry?.stranded) {
    return { state: 'dead', reason: 'no-refresh' }
  }
  const expiresAt =
    inputs.setupTokenCreatedAt !== null
      ? inputs.setupTokenCreatedAt + SETUP_TOKEN_LIFETIME_MS
      : inputs.expiry && !inputs.expiry.refreshable
        ? inputs.expiry.expiresAt
        : null
  if (expiresAt === null) {
    return { state: 'ok' }
  }
  if (expiresAt <= inputs.now) {
    return { state: 'dead', reason: 'expired' }
  }
  // A token that cannot renew itself is always worth flagging; a setup token only near its end.
  const warnFrom =
    inputs.setupTokenCreatedAt !== null ? expiresAt - SETUP_TOKEN_WARNING_MS : inputs.now
  return inputs.now >= warnFrom ? { state: 'expiring', expiresAt } : { state: 'ok' }
}
