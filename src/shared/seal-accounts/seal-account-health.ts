import type { SealAccountHealth } from './seal-account-candidates'

/** `claude setup-token` issues a token that lasts one year. */
export const SETUP_TOKEN_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000
const SETUP_TOKEN_WARNING_MS = 30 * 24 * 60 * 60 * 1000

/** What Seal knows about a stored login without calling the provider. */
export type SealLoginExpiry = {
  /** When the stored access token stops working. */
  expiresAt: number | null
  /** Holds a refresh token, so the provider CLI renews it on its own. */
  refreshable: boolean
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
  if (inputs.needsSignIn) {
    return { state: 'dead', reason: 'signed-out' }
  }
  if (inputs.authFailure) {
    return { state: 'dead', reason: 'rejected' }
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
