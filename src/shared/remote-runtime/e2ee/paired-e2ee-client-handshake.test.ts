import { describe, expect, it } from 'vitest'
import {
  createMobileE2EEV2Fixture,
  MOBILE_E2EE_V2_VECTOR,
  mobileE2EEV2FixtureX25519
} from './mobile-e2ee-v2-fixtures'
import { sealMobileE2EEV2Frame } from './mobile-e2ee-v2-framing'
import { createPairedE2EEClientHandshake } from './paired-e2ee-client-handshake'
import { NODE_PAIRED_E2EE_PRIMITIVES } from './node/paired-e2ee-node-primitives'

describe('paired E2EE client handshake: v2 framing', () => {
  function v2Handshake() {
    const fixture = createMobileE2EEV2Fixture()
    const handshake = createPairedE2EEClientHandshake({
      primitives: { ...NODE_PAIRED_E2EE_PRIMITIVES, x25519: mobileE2EEV2FixtureX25519(fixture) },
      hostPublicKeyB64: fixture.ready.desktopPublicKeyB64,
      transport: 'relay',
      relayHostId: fixture.hello.context.relayHostId,
      clientKeyPair: { publicKey: new Uint8Array(32).fill(1), secretKey: new Uint8Array(32) },
      clientNonce: new Uint8Array(32).fill(2)
    })
    return { fixture, handshake }
  }

  it('opens host frames in counter order only', () => {
    const { fixture, handshake } = v2Handshake()
    handshake.acceptReadyText(JSON.stringify(fixture.ready))
    const seal = (text: string, counter: bigint) =>
      Buffer.from(
        sealMobileE2EEV2Frame({
          payload: new TextEncoder().encode(text),
          key: Buffer.from(MOBILE_E2EE_V2_VECTOR.desktopToMobileKeyHex, 'hex'),
          sessionId: Buffer.from(MOBILE_E2EE_V2_VECTOR.sessionIdHex, 'hex'),
          direction: 'desktop-to-mobile',
          payloadKind: 'text',
          counter
        })
      ).toString('base64')
    const first = seal('one', 0n)
    expect(handshake.channel.openText(first)).toBe('one')
    expect(handshake.channel.openText(first)).toBeNull()
    expect(handshake.channel.openText(seal('two', 1n))).toBe('two')
  })

  it('reports an outdated host and stays unkeyed when the ready has no per-session key', () => {
    const {
      desktopEphemeralPublicKeyB64: _ephemeral,
      selection,
      ...preForwardSecrecy
    } = createMobileE2EEV2Fixture().ready
    const outdatedReadies = [
      { type: 'e2ee_ready' },
      { ...preForwardSecrecy, selection: { framing: 2, payloadKinds: ['text', 'binary'] } }
    ]
    for (const ready of outdatedReadies) {
      const { handshake } = v2Handshake()
      expect(handshake.acceptReadyText(JSON.stringify(ready))).toBe('host_outdated')
      expect(handshake.transcriptHashB64()).toBeNull()
      expect(() => handshake.channel.sealText('{}')).toThrow()
      expect(handshake.channel.openText('AAAA')).toBeNull()
    }
    expect(selection.forwardSecrecy).toBe(true)
  })

  it('refuses a ready whose per-session key is a low-order point', () => {
    const { fixture, handshake } = v2Handshake()
    const ready = {
      ...fixture.ready,
      // An order-8 point: its X25519 output is all zeros for every client key.
      desktopEphemeralPublicKeyB64: 'X5yVvKNQjCSx0LFVnIPvWwREXMRYHI6G2CJO3dCfEVc='
    }
    expect(handshake.acceptReadyText(JSON.stringify(ready))).toBe('unexpected')
    expect(handshake.transcriptHashB64()).toBeNull()
  })

  it('refuses to dial a pinned host key that is a low-order point', () => {
    expect(() =>
      createPairedE2EEClientHandshake({
        primitives: NODE_PAIRED_E2EE_PRIMITIVES,
        hostPublicKeyB64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
        transport: 'direct'
      })
    ).toThrow('low-order')
  })

  it('accepts one ready only: a second cannot re-key the session', () => {
    const { fixture, handshake } = v2Handshake()
    expect(handshake.acceptReadyText(JSON.stringify(fixture.ready))).toBe('accepted')
    expect(handshake.acceptReadyText(JSON.stringify(fixture.ready))).toBe('unexpected')
  })
})
