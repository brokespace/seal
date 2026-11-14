import { deriveRelayHostIdFromPublicKeyB64 } from '../../../../src/shared/remote-runtime/relay/relay-host-id'

// The gateway names a host by its relay host id; map it back through stored keys.

const HOST_FINGERPRINT_LENGTH = 16

// Unreadable stored keys cannot shadow a later valid match.
export const deriveHostFingerprint = deriveRelayHostIdFromPublicKeyB64

export function resolveHostIdForFingerprint(
  fingerprint: string,
  hosts: readonly { readonly id: string; readonly publicKeyB64: string }[]
): string | null {
  if (fingerprint.length !== HOST_FINGERPRINT_LENGTH) {
    return null
  }
  for (const host of hosts) {
    if (deriveHostFingerprint(host.publicKeyB64) === fingerprint) {
      return host.id
    }
  }
  return null
}
