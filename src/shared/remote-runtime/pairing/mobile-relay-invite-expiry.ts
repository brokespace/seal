// Mirrors cloud/packages/relay-contract RELAY_PROTOCOL_LIMITS.inviteTtlMs.
export const RELAY_INVITE_TTL_MS = 10 * 60 * 1000
// Cell-stamped expiry needs skew leeway or an ahead cell clock invalidates every invite (as with host-proof freshness).
export const RELAY_INVITE_EXPIRY_CLOCK_SKEW_MS = 30 * 1000

/** A relay-supplied invite expiry is usable only inside the invite lifetime plus clock skew. */
export function isLiveRelayInviteExpiry(expiresAt: number, now: number): boolean {
  return (
    expiresAt > now && expiresAt <= now + RELAY_INVITE_TTL_MS + RELAY_INVITE_EXPIRY_CLOCK_SKEW_MS
  )
}
