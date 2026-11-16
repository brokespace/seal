import { describe, expect, it } from 'vitest'
import { validateMobileE2EEV2Handshake } from './mobile-e2ee-v2-contract'
import { createMobileE2EEV2Fixture } from './mobile-e2ee-v2-fixtures'

describe('mobile E2EE v2 contract', () => {
  it('rejects an unechoed client nonce', () => {
    const { hello, ready } = createMobileE2EEV2Fixture()
    expect(
      validateMobileE2EEV2Handshake(hello, {
        ...ready,
        clientNonceB64: btoa(String.fromCharCode(...new Uint8Array(32).fill(9)))
      })
    ).toBeNull()
  })

  it('rejects different relay contexts across the handshake', () => {
    const { hello, ready } = createMobileE2EEV2Fixture()
    expect(
      validateMobileE2EEV2Handshake(hello, {
        ...ready,
        context: { ...ready.context, relayHostId: 'ZbCdEf0123_-xyZ9' }
      })
    ).toBeNull()
  })

  it('refuses a hello or ready that does not carry forward secrecy', () => {
    const { hello, ready } = createMobileE2EEV2Fixture()
    const { desktopEphemeralPublicKeyB64: _ephemeral, ...readyWithoutEphemeralKey } = ready
    expect(
      validateMobileE2EEV2Handshake(
        { ...hello, capabilities: { framing: [2], payloadKinds: ['text', 'binary'] } },
        ready
      )
    ).toBeNull()
    expect(validateMobileE2EEV2Handshake(hello, readyWithoutEphemeralKey)).toBeNull()
    expect(
      validateMobileE2EEV2Handshake(hello, {
        ...ready,
        selection: { framing: 2, payloadKinds: ['text', 'binary'] }
      })
    ).toBeNull()
    expect(
      validateMobileE2EEV2Handshake(hello, {
        ...ready,
        selection: { ...ready.selection, forwardSecrecy: false }
      })
    ).toBeNull()
  })

  it('refuses a low-order X25519 key in any key field', () => {
    const { hello, ready } = createMobileE2EEV2Fixture()
    // The all-zero point, and an order-8 point with the ignored top bit set.
    const lowOrderKeys = [
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      '4Ot6fDtBuK4WVuP68Z/EatoJjeucMrH9hmIFFl9JuIA='
    ]
    for (const lowOrderKey of lowOrderKeys) {
      expect(
        validateMobileE2EEV2Handshake({ ...hello, clientPublicKeyB64: lowOrderKey }, ready)
      ).toBeNull()
      expect(
        validateMobileE2EEV2Handshake(hello, { ...ready, desktopPublicKeyB64: lowOrderKey })
      ).toBeNull()
      expect(
        validateMobileE2EEV2Handshake(hello, {
          ...ready,
          desktopEphemeralPublicKeyB64: lowOrderKey
        })
      ).toBeNull()
    }
  })
})
