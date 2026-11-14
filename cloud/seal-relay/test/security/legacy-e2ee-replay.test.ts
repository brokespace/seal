import nacl from 'tweetnacl'
import type { WebSocket } from 'ws'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { E2EEChannel } from '../../../../src/main/runtime/rpc/mobile/e2ee/e2ee-channel'
import { createPairedE2EEClientHandshake } from '../../../../src/shared/remote-runtime/e2ee/paired-e2ee-client-handshake'
import { NODE_PAIRED_E2EE_PRIMITIVES } from '../../../../src/shared/remote-runtime/e2ee/node/paired-e2ee-node-primitives'

const serverKeys = nacl.box.keyPair.fromSecretKey(new Uint8Array(32).fill(7))
const clientKeys = nacl.box.keyPair.fromSecretKey(new Uint8Array(32).fill(9))

/** A desktop E2EE endpoint on the direct (LAN) transport, where legacy framing used to be accepted. */
function directChannel() {
  const sent: string[] = []
  const ws = {
    OPEN: 1 as const,
    readyState: 1,
    bufferedAmount: 0,
    send: (data: string | Buffer) => sent.push(data.toString()),
    close: vi.fn()
  }
  const delivered: string[] = []
  const onReady = vi.fn()
  const onError = vi.fn()
  const channel = new E2EEChannel(ws as unknown as WebSocket, {
    serverSecretKey: serverKeys.secretKey,
    resolveAuthenticatedDevice: (token) =>
      token === 'valid-token'
        ? {
            deviceId: 'device-1',
            deviceToken: token,
            scope: 'mobile',
            clientId: token,
            callerFingerprint: 'fp',
            credentialRevision: 0
          }
        : null,
    onReady,
    onError
  })
  channel.onMessage((plaintext) => delivered.push(plaintext))
  return { sent, channel, delivered, onReady, onError }
}

/** The removed legacy framing, as an attacker's own tooling would still produce it. */
function legacySeal(plaintext: string, sharedKey: Uint8Array): string {
  const nonce = new Uint8Array(nacl.box.nonceLength).fill(3)
  const box = nacl.box.after(new TextEncoder().encode(plaintext), nonce, sharedKey)
  return Buffer.concat([nonce, box]).toString('base64')
}

/** A paired client that completes the only handshake the host still speaks. */
async function authenticatedClient(host: ReturnType<typeof directChannel>) {
  const handshake = createPairedE2EEClientHandshake({
    primitives: NODE_PAIRED_E2EE_PRIMITIVES,
    hostPublicKeyB64: Buffer.from(serverKeys.publicKey).toString('base64'),
    transport: 'direct',
    v2TokenCapabilities: true
  })
  const helloFrame = handshake.helloText()
  host.channel.handleRawMessage(helloFrame)
  expect(handshake.acceptReadyText(host.sent[0]!)).toBe('accepted')
  const authFrame = await handshake.sealAuth({ kind: 'token', deviceToken: 'valid-token' })
  host.channel.handleRawMessage(authFrame)
  expect(host.onReady).toHaveBeenCalledOnce()
  return { handshake, helloFrame, authFrame }
}

const mutation = (seq: number) =>
  JSON.stringify({ seq, method: 'terminal.send', params: { data: 'rm -rf ~/work\n' } })

describe('E2EE-01: legacy framing is removed, and a session cannot be replayed or reordered', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('refuses the recorded legacy session on a direct socket without answering it', () => {
    const sharedKey = nacl.box.before(serverKeys.publicKey, clientKeys.secretKey)
    const host = directChannel()

    host.channel.handleRawMessage(
      JSON.stringify({
        type: 'e2ee_hello',
        publicKeyB64: Buffer.from(clientKeys.publicKey).toString('base64')
      })
    )
    host.channel.handleRawMessage(
      legacySeal(JSON.stringify({ type: 'e2ee_auth', deviceToken: 'valid-token' }), sharedKey)
    )
    host.channel.handleRawMessage(legacySeal(mutation(1), sharedKey))

    expect(host.sent).toEqual([])
    expect(host.onError).toHaveBeenCalledWith(4001, 'E2EE v2 required')
    expect(host.onReady).not.toHaveBeenCalled()
    expect(host.delivered).toEqual([])
  })

  it('does not accept a captured session replayed onto a brand-new socket', async () => {
    const live = directChannel()
    const client = await authenticatedClient(live)
    const mutationFrame = client.handshake.channel.sealText(mutation(1))
    live.channel.handleRawMessage(mutationFrame)
    expect(live.delivered).toEqual([mutation(1)])

    // The same bytes on a fresh connection: the host's new nonce and per-session key change every key.
    const replay = directChannel()
    replay.channel.handleRawMessage(client.helloFrame)
    replay.channel.handleRawMessage(client.authFrame)
    replay.channel.handleRawMessage(mutationFrame)

    expect(replay.onReady).not.toHaveBeenCalled()
    expect(replay.onError).toHaveBeenCalledWith(4001, 'Unauthorized')
    expect(replay.delivered).toEqual([])
  })

  it('drops reordered and duplicated frames within one authenticated session', async () => {
    const live = directChannel()
    const { handshake } = await authenticatedClient(live)
    const first = handshake.channel.sealText(mutation(1))
    const second = handshake.channel.sealText(mutation(2))

    live.channel.handleRawMessage(second)
    expect(live.delivered).toEqual([])
    live.channel.handleRawMessage(first)
    live.channel.handleRawMessage(first)
    expect(live.delivered).toEqual([mutation(1)])
    live.channel.handleRawMessage(second)
    expect(live.delivered).toEqual([mutation(1), mutation(2)])
  })
})
