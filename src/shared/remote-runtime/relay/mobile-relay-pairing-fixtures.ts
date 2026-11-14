import type { PairingOffer } from '../pairing/mobile-relay-pairing-offer'
import { PAIRING_URL_PREFIX } from '../pairing/pairing-url-scheme'

const PUBLIC_KEY_B64 = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA='
// SHA-256 of the 32 bytes 1..32, base64url, first 16 characters.
const RELAY_HOST_ID = 'riFsLvUkejeCwTXv'
const LOW_ORDER_PUBLIC_KEY_B64 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
const LOW_ORDER_RELAY_HOST_ID = 'Zmh6rfhivXdsj8GL'
const INVITE_TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGH012345678'

export type PairingFixture = {
  name: string
  payload: unknown
  expected: PairingOffer | null
}

export function createMobileRelayPairingFixtures(now: number): PairingFixture[] {
  const directOffer: PairingOffer = {
    v: 2,
    endpoint: 'ws://192.168.1.10:6768',
    deviceToken: 'device-token',
    publicKeyB64: PUBLIC_KEY_B64
  }
  const relay = {
    v: 1 as const,
    directorUrl: 'https://relay.onorca.dev',
    cellUrl: 'https://relay-c1.onorca.dev',
    assignmentEpoch: 7,
    relayHostId: RELAY_HOST_ID,
    inviteToken: INVITE_TOKEN,
    inviteExpiresAt: now + 5 * 60 * 1000,
    e2eeFraming: 2 as const
  }
  return [
    { name: 'legacy direct offer', payload: directOffer, expected: directOffer },
    {
      name: 'legacy direct offer with mobile scope',
      payload: { ...directOffer, scope: 'mobile' },
      expected: { ...directOffer, scope: 'mobile' }
    },
    {
      name: 'relay offer with absent scope',
      payload: { ...directOffer, relay },
      expected: { ...directOffer, relay }
    },
    {
      name: 'relay offer with mobile scope',
      payload: { ...directOffer, scope: 'mobile', relay },
      expected: { ...directOffer, scope: 'mobile', relay }
    },
    {
      name: 'unknown keys are stripped at both levels',
      payload: { ...directOffer, ignored: true, relay: { ...relay, ignored: true } },
      expected: { ...directOffer, relay }
    },
    {
      name: 'offer-level endpoints are stripped',
      payload: { ...directOffer, endpoints: [{ kind: 'relay' }] },
      expected: directOffer
    },
    {
      name: 'runtime relay is invalid',
      payload: { ...directOffer, scope: 'runtime', relay },
      expected: null
    },
    {
      name: 'relay offer public key must be canonical 32-byte base64',
      payload: { ...directOffer, publicKeyB64: 'legacy-nonempty-key', relay },
      expected: null
    },
    {
      name: 'non-canonical director origin is invalid',
      payload: { ...directOffer, relay: { ...relay, directorUrl: 'https://relay.onorca.dev/' } },
      expected: null
    },
    {
      name: 'non-HTTPS cell origin is invalid',
      payload: { ...directOffer, relay: { ...relay, cellUrl: 'http://relay-c1.onorca.dev' } },
      expected: null
    },
    {
      name: 'fractional assignment epoch is invalid',
      payload: { ...directOffer, relay: { ...relay, assignmentEpoch: 1.5 } },
      expected: null
    },
    {
      name: 'negative assignment epoch is invalid',
      payload: { ...directOffer, relay: { ...relay, assignmentEpoch: -1 } },
      expected: null
    },
    {
      name: 'unsafe assignment epoch is invalid',
      payload: {
        ...directOffer,
        relay: { ...relay, assignmentEpoch: Number.MAX_SAFE_INTEGER + 1 }
      },
      expected: null
    },
    {
      name: 'relay host id length is invalid',
      payload: { ...directOffer, relay: { ...relay, relayHostId: 'short' } },
      expected: null
    },
    {
      name: 'relay host id not derived from the offered public key is invalid',
      payload: { ...directOffer, relay: { ...relay, relayHostId: 'AbCdEf0123_-xyZ9' } },
      expected: null
    },
    {
      name: 'low-order public key is invalid for a relay offer',
      payload: {
        ...directOffer,
        publicKeyB64: LOW_ORDER_PUBLIC_KEY_B64,
        relay: { ...relay, relayHostId: LOW_ORDER_RELAY_HOST_ID }
      },
      expected: null
    },
    {
      name: 'invite token length is invalid',
      payload: { ...directOffer, relay: { ...relay, inviteToken: 'short' } },
      expected: null
    },
    {
      name: 'expired invite is invalid',
      payload: { ...directOffer, relay: { ...relay, inviteExpiresAt: now } },
      expected: null
    },
    {
      name: 'full-TTL invite from a cell clock up to 30s ahead is valid',
      payload: {
        ...directOffer,
        relay: { ...relay, inviteExpiresAt: now + 10 * 60 * 1000 + 30 * 1000 }
      },
      expected: {
        ...directOffer,
        relay: { ...relay, inviteExpiresAt: now + 10 * 60 * 1000 + 30 * 1000 }
      }
    },
    {
      name: 'invite beyond ten minutes plus skew leeway is invalid',
      payload: {
        ...directOffer,
        relay: { ...relay, inviteExpiresAt: now + 10 * 60 * 1000 + 30 * 1000 + 1 }
      },
      expected: null
    },
    {
      name: 'unsupported E2EE framing is invalid',
      payload: { ...directOffer, relay: { ...relay, e2eeFraming: 1 } },
      expected: null
    }
  ]
}

export function encodePairingFixturePayload(payload: unknown): string {
  const json = JSON.stringify(payload)
  const code = Buffer.from(json, 'utf8').toString('base64url')
  return `${PAIRING_URL_PREFIX}?code=${code}`
}
