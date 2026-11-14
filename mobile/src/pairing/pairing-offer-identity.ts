import type { PairingOffer } from '../../../src/shared/remote-runtime/pairing/mobile-relay-pairing-offer'
import {
  deriveRelayHostIdFromPublicKeyB64,
  formatRelayHostFingerprint
} from '../../../src/shared/remote-runtime/relay/relay-host-id'
import { isBuildRelayDirector } from '../transport/relay/mobile-relay-cell-pin'

export type PairingOfferIdentity = {
  /** Set when the code's key is one this phone already paired: confirming replaces that pairing. */
  knownHostName: string | null
  /** Null for a key that is not 32 bytes, which only an old direct-only code can carry. */
  fingerprint: string | null
  /** Null for a direct-only code. */
  relayOrigin: string | null
  usesOtherRelay: boolean
  directEndpoint: string
}

// A code carries no host name, and one inside it would be the sender's claim: the key is the identity.
export function describePairingOfferIdentity(
  offer: PairingOffer,
  pairedHosts: readonly { name: string; publicKeyB64: string }[]
): PairingOfferIdentity {
  const relayHostId = deriveRelayHostIdFromPublicKeyB64(offer.publicKeyB64)
  const relayOrigin = offer.relay?.directorUrl ?? null
  return {
    knownHostName:
      pairedHosts.find((host) => host.publicKeyB64 === offer.publicKeyB64)?.name ?? null,
    fingerprint: relayHostId ? formatRelayHostFingerprint(relayHostId) : null,
    relayOrigin,
    usesOtherRelay: relayOrigin !== null && !isBuildRelayDirector(relayOrigin),
    directEndpoint: offer.endpoint
  }
}
