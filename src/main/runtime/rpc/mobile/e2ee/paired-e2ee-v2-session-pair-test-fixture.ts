import {
  createPairedE2EEClientHandshake,
  type PairedE2EEClientHandshake
} from '../../../../../shared/remote-runtime/e2ee/paired-e2ee-client-handshake'
import {
  generateKeyPair,
  publicKeyToBase64
} from '../../../../../shared/remote-runtime/e2ee/node/e2ee-crypto'
import { NODE_PAIRED_E2EE_PRIMITIVES } from '../../../../../shared/remote-runtime/e2ee/node/paired-e2ee-node-primitives'
import { DesktopMobileE2EEV2Session } from './mobile-e2ee-v2-desktop-session'

export type PairedE2EEV2SessionPair = {
  /** The client side; its ready is not accepted until a test feeds it `readyText`. */
  handshake: PairedE2EEClientHandshake
  /** The host side, already keyed. It opens the client's frames in the order they were sealed. */
  host: DesktopMobileE2EEV2Session
  readyText: string
  authenticatedText: () => string
}

/** A real client handshake and the host session that answered its hello, for tests that feed frames without sockets. */
export function createPairedE2EEV2SessionPairForTest(): PairedE2EEV2SessionPair {
  const hostKeyPair = generateKeyPair()
  const handshake = createPairedE2EEClientHandshake({
    primitives: NODE_PAIRED_E2EE_PRIMITIVES,
    hostPublicKeyB64: publicKeyToBase64(hostKeyPair.publicKey),
    transport: 'direct',
    v2TokenCapabilities: true
  })
  const host = DesktopMobileE2EEV2Session.create({
    hello: JSON.parse(handshake.helloText()),
    serverSecretKey: hostKeyPair.secretKey,
    expectedContext: { transport: 'direct' }
  })
  if (!host) {
    throw new Error('Test host refused the client hello')
  }
  return {
    handshake,
    host,
    readyText: JSON.stringify(host.ready),
    authenticatedText: () =>
      host.sealText(
        JSON.stringify({
          type: 'e2ee_authenticated',
          v: 2,
          transcriptHashB64: host.transcriptHashB64
        })
      )
  }
}
