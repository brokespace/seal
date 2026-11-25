import nacl from 'tweetnacl'
import {
  encodeMobileE2EEV2Transcript,
  validateMobileE2EEV2Handshake,
  type MobileE2EEV2Hello,
  type MobileE2EEV2Ready
} from '../../../../src/shared/remote-runtime/e2ee/mobile-e2ee-v2-contract'
import type { PairedE2EEV2KeySchedule } from '../../../../src/shared/remote-runtime/e2ee/paired-e2ee-primitives'
import { derivePairedE2EEV2KeySchedule } from '../../../../src/shared/remote-runtime/e2ee/paired-e2ee-v2-key-schedule'

const desktopStatic = nacl.box.keyPair.fromSecretKey(new Uint8Array(32).fill(1))
const desktopEphemeral = nacl.box.keyPair.fromSecretKey(new Uint8Array(32).fill(5))

export const TEST_DESKTOP_PUBLIC_KEY_B64 = Buffer.from(desktopStatic.publicKey).toString('base64')

/** The desktop's half of one handshake: the ready it answers a hello with and the keys it then holds. */
export function answerMobileE2EEV2HelloForTest(hello: MobileE2EEV2Hello): {
  ready: MobileE2EEV2Ready
  schedule: PairedE2EEV2KeySchedule
} {
  const ready: MobileE2EEV2Ready = {
    type: 'e2ee_ready',
    v: 2,
    desktopPublicKeyB64: TEST_DESKTOP_PUBLIC_KEY_B64,
    desktopEphemeralPublicKeyB64: Buffer.from(desktopEphemeral.publicKey).toString('base64'),
    clientNonceB64: hello.clientNonceB64,
    desktopNonceB64: Buffer.from(new Uint8Array(32).fill(4)).toString('base64'),
    selection: { framing: 2, payloadKinds: ['text', 'binary'], forwardSecrecy: true },
    context: hello.context
  }
  const handshake = validateMobileE2EEV2Handshake(hello, ready)
  if (!handshake) {
    throw new Error('Fixture handshake failed')
  }
  return {
    ready,
    schedule: derivePairedE2EEV2KeySchedule({
      staticSharedSecret: nacl.scalarMult(desktopStatic.secretKey, handshake.clientPublicKey),
      ephemeralSharedSecret: nacl.scalarMult(desktopEphemeral.secretKey, handshake.clientPublicKey),
      transcript: encodeMobileE2EEV2Transcript(handshake),
      clientNonce: handshake.clientNonce,
      desktopNonce: handshake.desktopNonce
    })
  }
}
