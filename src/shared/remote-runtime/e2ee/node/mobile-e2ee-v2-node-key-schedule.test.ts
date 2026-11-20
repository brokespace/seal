import { describe, expect, it } from 'vitest'
import {
  encodeMobileE2EEV2Transcript,
  validateMobileE2EEV2Handshake
} from '../mobile-e2ee-v2-contract'
import { createMobileE2EEV2Fixture, MOBILE_E2EE_V2_VECTOR } from '../mobile-e2ee-v2-fixtures'
import { deriveMobileE2EEV2KeySchedule } from './mobile-e2ee-v2-node-key-schedule'

describe('desktop mobile E2EE v2 key schedule', () => {
  it('derives the normative 96-byte HKDF vector', () => {
    const { hello, ready, staticSharedSecret, ephemeralSharedSecret } = createMobileE2EEV2Fixture()
    const handshake = validateMobileE2EEV2Handshake(hello, ready)!
    const schedule = deriveMobileE2EEV2KeySchedule({
      staticSharedSecret,
      ephemeralSharedSecret,
      transcript: encodeMobileE2EEV2Transcript(handshake),
      clientNonce: handshake.clientNonce,
      desktopNonce: handshake.desktopNonce
    })

    expect(Buffer.from(schedule.mobileToDesktopKey).toString('hex')).toBe(
      MOBILE_E2EE_V2_VECTOR.mobileToDesktopKeyHex
    )
    expect(Buffer.from(schedule.desktopToMobileKey).toString('hex')).toBe(
      MOBILE_E2EE_V2_VECTOR.desktopToMobileKeyHex
    )
    expect(Buffer.from(schedule.sessionId).toString('hex')).toBe(MOBILE_E2EE_V2_VECTOR.sessionIdHex)
    expect(Buffer.from(schedule.transcriptHash).toString('hex')).toBe(
      MOBILE_E2EE_V2_VECTOR.transcriptHashHex
    )
  })

  it('derives different keys when only the per-session secret differs', () => {
    const { hello, ready, staticSharedSecret } = createMobileE2EEV2Fixture()
    const handshake = validateMobileE2EEV2Handshake(hello, ready)!
    const schedule = deriveMobileE2EEV2KeySchedule({
      staticSharedSecret,
      ephemeralSharedSecret: new Uint8Array(32).fill(8),
      transcript: encodeMobileE2EEV2Transcript(handshake),
      clientNonce: handshake.clientNonce,
      desktopNonce: handshake.desktopNonce
    })

    // Computed outside this codebase (Python hashlib/hmac) for an all-8s per-session secret.
    expect(Buffer.from(schedule.desktopToMobileKey).toString('hex')).toBe(
      '34d8db4e21ca72d4cb5a3d27d800f520457f44724427d19d1e27ed3e4f7a3ae1'
    )
  })
})
