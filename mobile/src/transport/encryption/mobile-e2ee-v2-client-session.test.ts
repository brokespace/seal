import { describe, expect, it, vi } from 'vitest'
import nacl from 'tweetnacl'
import type { PairedE2EEV2KeySchedule } from '../../../../src/shared/remote-runtime/e2ee/paired-e2ee-primitives'
import { sealMobileE2EEV2Frame } from '../../../../src/shared/remote-runtime/e2ee/mobile-e2ee-v2-framing'

vi.mock('expo-crypto', () => ({
  getRandomBytes: (length: number) => new Uint8Array(length).fill(9)
}))

import { MobileE2EEV2ClientSession } from './mobile-e2ee-v2-client-session'
import {
  answerMobileE2EEV2HelloForTest,
  TEST_DESKTOP_PUBLIC_KEY_B64
} from './mobile-e2ee-v2-desktop-test-peer'

const client = nacl.box.keyPair.fromSecretKey(new Uint8Array(32).fill(2))

function setup() {
  const session = MobileE2EEV2ClientSession.create({
    desktopPublicKeyB64: TEST_DESKTOP_PUBLIC_KEY_B64,
    transport: 'relay',
    relayHostId: 'AbCdEf0123_-xyZ9',
    clientNonce: new Uint8Array(32).fill(3),
    clientKeyPair: client
  })
  return { session, ...answerMobileE2EEV2HelloForTest(session.hello) }
}

function pairedSession() {
  const { session, ready, schedule } = setup()
  expect(session.acceptReady(ready)).toBe(true)
  return { session, schedule }
}

function desktopTextFrame(plaintext: string, schedule: PairedE2EEV2KeySchedule): string {
  return Buffer.from(
    sealMobileE2EEV2Frame({
      payload: new TextEncoder().encode(plaintext),
      key: schedule.desktopToMobileKey,
      sessionId: schedule.sessionId,
      direction: 'desktop-to-mobile',
      payloadKind: 'text',
      counter: 0n
    })
  ).toString('base64')
}

describe('mobile E2EE v2 client session', () => {
  it('refuses a ready from any key but the pinned desktop key', () => {
    const { session, ready } = setup()
    expect(
      session.acceptReady({
        ...ready,
        desktopPublicKeyB64: Buffer.from(new Uint8Array(32).fill(8)).toString('base64')
      })
    ).toBe(false)
    expect(session.isReady).toBe(false)
    expect(session.acceptReady(ready)).toBe(true)
  })

  it('refuses a desktop that answers without a per-session key', () => {
    const { session, ready } = setup()
    const { desktopEphemeralPublicKeyB64: _omitted, ...staticOnly } = ready

    expect(
      session.acceptReady({
        ...staticOnly,
        selection: { framing: 2, payloadKinds: ['text', 'binary'] }
      })
    ).toBe(false)
    expect(session.acceptReady({ type: 'e2ee_ready' })).toBe(false)
    expect(session.isReady).toBe(false)
  })

  it('refuses a low-order per-session desktop key', () => {
    const { session, ready } = setup()

    expect(
      session.acceptReady({
        ...ready,
        desktopEphemeralPublicKeyB64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
      })
    ).toBe(false)
    expect(session.isReady).toBe(false)
  })

  it('refuses to pair with a low-order desktop key', () => {
    expect(() =>
      MobileE2EEV2ClientSession.create({
        desktopPublicKeyB64: '4Ot6fDtBuK4WVuP68Z/EatoJjeucMrH9hmIFFl9JuIA=',
        transport: 'direct'
      })
    ).toThrow('low-order')
  })

  it('seals auth at counter zero and rejects replayed desktop frames', () => {
    const { session, schedule } = pairedSession()
    const auth = JSON.stringify({
      type: 'e2ee_auth',
      v: 2,
      transcriptHashB64: session.transcriptHashB64,
      deviceToken: 'token'
    })
    const authFrame = Buffer.from(session.sealText(auth), 'base64')
    expect(authFrame.subarray(16, 24)).toEqual(Buffer.alloc(8, 0))

    const encoded = desktopTextFrame('authenticated', schedule)
    expect(session.openText(encoded)).toBe('authenticated')
    expect(session.openText(encoded)).toBeNull()
  })
})
