import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { extractPairingCodeFromUrl, parsePairingCode } from './pairing'
import type { PairingOffer } from '../../../src/shared/remote-runtime/pairing/mobile-relay-pairing-offer'

const offer: PairingOffer = {
  v: 2,
  endpoint: 'ws://100.102.47.57:6768',
  deviceToken: 'token-abc',
  publicKeyB64: 'pubkey-xyz'
}

function encodeOffer(input: PairingOffer = offer): string {
  return btoa(JSON.stringify(input)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

describe('pairing deep links', () => {
  it('rejects lookalike routes', () => {
    expect(extractPairingCodeFromUrl('seal://pairing?code=abc123')).toBeNull()
  })

  it('accepts seal:// links and legacy orca:// links', () => {
    expect(parsePairingCode(`seal://pair?code=${encodeOffer()}`)).toEqual(offer)
    expect(parsePairingCode(`ORCA://pair#${encodeOffer()}`)).toEqual(offer)
  })
})

describe('relay pairing codes', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 1_800_000_000_000 })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  // SHA-256 of the 32 key bytes 1..32, base64url, first 16 characters.
  const relayOffer = (relay: Record<string, unknown> = {}): PairingOffer => ({
    ...offer,
    publicKeyB64: 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=',
    relay: {
      v: 1,
      directorUrl: 'https://relay.example',
      cellUrl: 'https://relay.example',
      assignmentEpoch: 7,
      relayHostId: 'riFsLvUkejeCwTXv',
      inviteToken: 'abcdefghijklmnopqrstuvwxyzABCDEFGH012345678',
      inviteExpiresAt: 1_800_000_300_000,
      e2eeFraming: 2,
      ...relay
    }
  })

  it("accepts a relay whose cell is its own director or this build's relay", () => {
    const selfHosted = relayOffer()
    const buildCell = relayOffer({ cellUrl: 'https://relay.seal.wotarmelon.com' })

    expect(parsePairingCode(encodeOffer(selfHosted))).toEqual(selfHosted)
    expect(parsePairingCode(encodeOffer(buildCell))).toEqual(buildCell)
  })

  it.each([
    ['a cell on another origin than its director', { cellUrl: 'https://cell.attacker.example' }],
    ['a relay host id that is not derived from the host key', { relayHostId: 'AAAAAAAAAAAAAAAA' }]
  ])('refuses a code naming %s', (_name, relay) => {
    expect(parsePairingCode(encodeOffer(relayOffer(relay)))).toBeNull()
  })
})
