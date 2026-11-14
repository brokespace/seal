import * as z from 'zod'
import {
  PAIRING_DEVICE_TOKEN_MAX_CHARACTERS,
  PAIRING_ENDPOINT_MAX_CHARACTERS,
  PAIRING_PUBLIC_KEY_MAX_CHARACTERS,
  PAIRING_RELAY_URL_MAX_CHARACTERS
} from './mobile-pairing-protocol-limits'
import { RuntimeHostDescriptorSchema } from '../host-status/runtime-host-descriptor'
import { isLowOrderX25519PublicKey } from '../e2ee/x25519-low-order-points'
import { isCanonicalRelayOrigin } from '../relay/relay-cell-origin-pin'
import { deriveRelayHostId } from '../relay/relay-host-id'
import { isLiveRelayInviteExpiry } from './mobile-relay-invite-expiry'

export const PAIRING_OFFER_VERSION = 2
const PairingScopeSchema = z.enum(['mobile', 'runtime'])
const BASE64URL_16_PATTERN = /^[A-Za-z0-9_-]{16}$/
const BASE64URL_43_PATTERN = /^[A-Za-z0-9_-]{43}$/

function isCanonicalHttpsOrigin(value: string): boolean {
  if (
    value.length > PAIRING_RELAY_URL_MAX_CHARACTERS ||
    new TextEncoder().encode(value).length > PAIRING_RELAY_URL_MAX_CHARACTERS
  ) {
    return false
  }
  return isCanonicalRelayOrigin(value)
}

function decodeCanonicalBase64Key(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    return null
  }
  try {
    const decoded = atob(value)
    if (decoded.length !== 32 || btoa(decoded) !== value) {
      return null
    }
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0))
  } catch {
    return null
  }
}

export function createPairingOfferSchema(now: () => number = () => Date.now()) {
  const relaySchema = z.object({
    v: z.literal(1),
    directorUrl: z
      .string()
      .min(1)
      .refine(isCanonicalHttpsOrigin, 'Expected canonical HTTPS origin'),
    cellUrl: z.string().min(1).refine(isCanonicalHttpsOrigin, 'Expected canonical HTTPS origin'),
    assignmentEpoch: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    relayHostId: z.string().regex(BASE64URL_16_PATTERN),
    inviteToken: z.string().regex(BASE64URL_43_PATTERN),
    inviteExpiresAt: z
      .number()
      .int()
      .refine(
        (value) => isLiveRelayInviteExpiry(value, now()),
        'Expected a future invite expiry no more than 10 minutes away'
      ),
    e2eeFraming: z.literal(2)
  })

  return z
    .object({
      v: z.literal(PAIRING_OFFER_VERSION),
      endpoint: z.string().min(1).max(PAIRING_ENDPOINT_MAX_CHARACTERS),
      deviceToken: z.string().min(1).max(PAIRING_DEVICE_TOKEN_MAX_CHARACTERS),
      publicKeyB64: z.string().min(1).max(PAIRING_PUBLIC_KEY_MAX_CHARACTERS),
      pairedDeviceId: z.string().min(1).max(128).optional(),
      scope: PairingScopeSchema.optional(),
      relay: relaySchema.optional(),
      // Why catch: a descriptor this build cannot read is dropped, never a reason to refuse pairing.
      hostDescriptor: RuntimeHostDescriptorSchema.optional().catch(undefined)
    })
    .superRefine((offer, ctx) => {
      if (offer.relay && offer.scope === 'runtime') {
        // Relay v1 supports mobile only; runtime offers would promise unsupported routing/credentials.
        ctx.addIssue({
          code: 'custom',
          path: ['relay'],
          message: 'Relay is invalid for runtime scope'
        })
      }
      if (!offer.relay) {
        return
      }
      // relayHostId derives from decoded bytes; refuse permissive legacy base64 aliases here.
      const publicKey = decodeCanonicalBase64Key(offer.publicKeyB64)
      if (!publicKey || isLowOrderX25519PublicKey(publicKey)) {
        ctx.addIssue({
          code: 'custom',
          path: ['publicKeyB64'],
          message: 'Relay offers require a canonical 32-byte public key'
        })
        return
      }
      if (offer.relay.relayHostId !== deriveRelayHostId(publicKey)) {
        // A known host's public key with another relay identity would alias that host onto a foreign relay.
        ctx.addIssue({
          code: 'custom',
          path: ['relay', 'relayHostId'],
          message: 'Relay host id must derive from the offered public key'
        })
      }
    })
}

export const PairingOfferSchema = createPairingOfferSchema()
export type PairingOffer = z.infer<typeof PairingOfferSchema>
export type PairingRelay = NonNullable<PairingOffer['relay']>
