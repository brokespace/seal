import type WebSocket from 'ws'
import { createPairedE2EEClientHandshake } from '../../../../../shared/remote-runtime/e2ee/paired-e2ee-client-handshake'
import { NODE_PAIRED_E2EE_PRIMITIVES } from '../../../../../shared/remote-runtime/e2ee/node/paired-e2ee-node-primitives'

export type PairedE2EEV2TestClient = {
  ws: WebSocket
  sendText: (plaintext: string) => void
  /** Host frames opened from now on; returns the unsubscribe. */
  onText: (listener: (plaintext: string) => void) => () => void
  onBinary: (listener: (bytes: Uint8Array) => void) => () => void
}

/**
 * Runs the real client handshake and token auth on an open socket. It owns the socket's message
 * listener afterwards, because a v2 frame opens once, in order: tests read plaintext from it.
 */
export function authenticatePairedE2EEV2TestClient(
  ws: WebSocket,
  args: { hostPublicKeyB64: string; deviceToken: string; clientCapabilities?: readonly string[] }
): Promise<PairedE2EEV2TestClient> {
  const handshake = createPairedE2EEClientHandshake({
    primitives: NODE_PAIRED_E2EE_PRIMITIVES,
    hostPublicKeyB64: args.hostPublicKeyB64,
    transport: 'direct',
    v2TokenCapabilities: true
  })
  const textListeners = new Set<(plaintext: string) => void>()
  const binaryListeners = new Set<(bytes: Uint8Array) => void>()
  const client: PairedE2EEV2TestClient = {
    ws,
    sendText: (plaintext) => ws.send(handshake.channel.sealText(plaintext)),
    onText: (listener) => {
      textListeners.add(listener)
      return () => textListeners.delete(listener)
    },
    onBinary: (listener) => {
      binaryListeners.add(listener)
      return () => binaryListeners.delete(listener)
    }
  }
  return new Promise((resolve, reject) => {
    let stage: 'ready' | 'auth' | 'open' = 'ready'
    ws.once('close', (code, reason) =>
      reject(new Error(`Host closed during the E2EE handshake (${code}: ${reason.toString()})`))
    )
    ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        const bytes = handshake.channel.openBinary(new Uint8Array(data))
        if (bytes) {
          binaryListeners.forEach((listener) => listener(bytes))
        }
        return
      }
      const frame = data.toString()
      if (stage === 'ready') {
        const verdict = handshake.acceptReadyText(frame)
        if (verdict !== 'accepted') {
          reject(new Error(`Host ready was ${verdict}`))
          return
        }
        stage = 'auth'
        void handshake
          .sealAuth(
            { kind: 'token', deviceToken: args.deviceToken },
            { clientCapabilities: args.clientCapabilities }
          )
          .then((auth) => ws.send(auth), reject)
        return
      }
      const plaintext = handshake.channel.openText(frame)
      if (plaintext === null) {
        return
      }
      if (stage === 'auth') {
        const reply = handshake.classifyAuthReply(plaintext)
        if (reply.kind !== 'authenticated') {
          reject(new Error(`Host refused the device token: ${plaintext}`))
          return
        }
        stage = 'open'
        resolve(client)
        return
      }
      textListeners.forEach((listener) => listener(plaintext))
    })
    ws.send(handshake.helloText())
  })
}
