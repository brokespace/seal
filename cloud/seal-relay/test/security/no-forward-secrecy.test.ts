import nacl from 'tweetnacl'
import { describe, expect, it } from 'vitest'
import { DesktopMobileE2EEV2Session } from '../../../../src/main/runtime/rpc/mobile/e2ee/mobile-e2ee-v2-desktop-session'
import {
  encodeMobileE2EEV2Transcript,
  validateMobileE2EEV2Handshake
} from '../../../../src/shared/remote-runtime/e2ee/mobile-e2ee-v2-contract'
import { openMobileE2EEV2Frame } from '../../../../src/shared/remote-runtime/e2ee/mobile-e2ee-v2-framing'
import { deriveMobileE2EEV2KeySchedule } from '../../../../src/shared/remote-runtime/e2ee/node/mobile-e2ee-v2-node-key-schedule'
import { createPairedE2EEClientHandshake } from '../../../../src/shared/remote-runtime/e2ee/paired-e2ee-client-handshake'
import { NODE_PAIRED_E2EE_PRIMITIVES } from '../../../../src/shared/remote-runtime/e2ee/node/paired-e2ee-node-primitives'

const DEVICE_TOKEN = 'c0ffee'.repeat(8)

/** Everything a passive observer (relay operator, on-path logger) records from one real session. */
async function recordSession(host: nacl.BoxKeyPair, hostSessionKey?: nacl.BoxKeyPair) {
  const phone = createPairedE2EEClientHandshake({
    primitives: NODE_PAIRED_E2EE_PRIMITIVES,
    hostPublicKeyB64: Buffer.from(host.publicKey).toString('base64'),
    transport: 'direct',
    v2TokenCapabilities: true
  })
  const hello: unknown = JSON.parse(phone.helloText())
  const session = DesktopMobileE2EEV2Session.create({
    hello,
    serverSecretKey: host.secretKey,
    expectedContext: { transport: 'direct' },
    ephemeralKeyPair: hostSessionKey
  })
  if (!session || phone.acceptReadyText(JSON.stringify(session.ready)) !== 'accepted') {
    throw new Error('Expected the phone and the host to complete the handshake')
  }
  const authFrame = await phone.sealAuth({ kind: 'token', deviceToken: DEVICE_TOKEN })
  return { hello, ready: session.ready, authFrame }
}

/** Opens the recorded auth frame with the keys an X25519 secret of the host would give. */
function openRecordedAuth(
  captured: Awaited<ReturnType<typeof recordSession>>,
  hostStaticSecret: Uint8Array,
  hostSessionSecret: Uint8Array
): string | null {
  const handshake = validateMobileE2EEV2Handshake(captured.hello, captured.ready)
  if (!handshake) {
    throw new Error('Expected a valid recorded handshake')
  }
  const schedule = deriveMobileE2EEV2KeySchedule({
    staticSharedSecret: nacl.scalarMult(hostStaticSecret, handshake.clientPublicKey),
    ephemeralSharedSecret: nacl.scalarMult(hostSessionSecret, handshake.clientPublicKey),
    transcript: encodeMobileE2EEV2Transcript(handshake),
    clientNonce: handshake.clientNonce,
    desktopNonce: handshake.desktopNonce
  })
  const plaintext = openMobileE2EEV2Frame({
    frame: new Uint8Array(Buffer.from(captured.authFrame, 'base64')),
    key: schedule.mobileToDesktopKey,
    sessionId: schedule.sessionId,
    direction: 'mobile-to-desktop',
    payloadKind: 'text',
    expectedCounter: 0n
  })
  return plaintext && new TextDecoder().decode(plaintext)
}

// The host identity key (orca-e2ee-keypair.json) is long-lived. Sessions are now also keyed by a
// per-session host key that is wiped after the handshake, so that file alone opens no recording.
describe('E2EE-02: a leaked host identity key does not open recorded sessions', () => {
  it('cannot recover the device bearer token from a capture plus the host secret', async () => {
    const host = nacl.box.keyPair()
    const captured = await recordSession(host)

    // Months later host.secretKey leaks. The thief has it and the whole wire capture, nothing else.
    expect(openRecordedAuth(captured, host.secretKey, host.secretKey)).toBeNull()
    expect(captured.authFrame).not.toContain(DEVICE_TOKEN)
  })

  it('opens that recording only with the per-session secret the host discards', async () => {
    const host = nacl.box.keyPair()
    const hostSessionKey = nacl.box.keyPair()
    const captured = await recordSession(host, hostSessionKey)

    expect(openRecordedAuth(captured, host.secretKey, host.secretKey)).toBeNull()
    expect(openRecordedAuth(captured, host.secretKey, hostSessionKey.secretKey)).toContain(
      DEVICE_TOKEN
    )
  })

  it('keys every session with a different host key', async () => {
    const host = nacl.box.keyPair()
    const first = await recordSession(host)
    const second = await recordSession(host)

    expect(first.ready.desktopPublicKeyB64).toBe(second.ready.desktopPublicKeyB64)
    expect(first.ready.desktopEphemeralPublicKeyB64).not.toBe(
      second.ready.desktopEphemeralPublicKeyB64
    )
  })
})
