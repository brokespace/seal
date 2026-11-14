import nacl from 'tweetnacl'
import type { WebSocket } from 'ws'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { E2EEChannel } from '../../../../src/main/runtime/rpc/mobile/e2ee/e2ee-channel'
import {
  decrypt,
  deriveSharedKey,
  encrypt
} from '../../../../src/shared/remote-runtime/e2ee/node/e2ee-crypto'
import { describePoc } from './poc-opt-in'

const serverKeys = nacl.box.keyPair.fromSecretKey(new Uint8Array(32).fill(7))
const clientKeys = nacl.box.keyPair.fromSecretKey(new Uint8Array(32).fill(9))

function mockWs() {
  const sent: string[] = []
  return {
    OPEN: 1 as const,
    readyState: 1,
    bufferedAmount: 0,
    send: vi.fn((data: string | Buffer) => sent.push(data.toString())),
    close: vi.fn(),
    sent
  }
}

/** A desktop E2EE endpoint on the direct transport, which still accepts legacy framing. */
function directChannel() {
  const ws = mockWs()
  const delivered: string[] = []
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
    onReady: vi.fn(),
    onError: vi.fn()
  })
  channel.onMessage((plaintext) => delivered.push(plaintext))
  return { ws, channel, delivered }
}

describePoc('PoC E2EE-01: legacy framing has no replay or reordering protection', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  // The shared key is nacl.box.before(host static, client pub): no per-session server randomness,
  // so a recorded transcript reproduces verbatim on any future socket to the same host.
  const sharedKey = deriveSharedKey(clientKeys.secretKey, serverKeys.publicKey)
  const helloFrame = JSON.stringify({
    type: 'e2ee_hello',
    publicKeyB64: Buffer.from(clientKeys.publicKey).toString('base64')
  })
  const authFrame = encrypt(JSON.stringify({ type: 'e2ee_auth', deviceToken: 'valid-token' }), sharedKey)
  const mutationFrame = encrypt(
    JSON.stringify({ method: 'terminal.send', params: { data: 'rm -rf ~/work\n' } }),
    sharedKey
  )

  it('replays a captured session, verbatim, onto a brand-new socket', () => {
    // Record a legitimate legacy session.
    const live = directChannel()
    live.channel.handleRawMessage(helloFrame)
    expect(JSON.parse(live.ws.sent[0]!)).toEqual({ type: 'e2ee_ready' })
    live.channel.handleRawMessage(authFrame)
    live.channel.handleRawMessage(mutationFrame)
    expect(live.delivered).toHaveLength(1)
    expect(JSON.parse(live.delivered[0]!).params.data).toBe('rm -rf ~/work\n')

    // An attacker who captured those exact bytes (relay operator, or on-path before the host is
    // v2-latched) replays them on a fresh connection with no key, no token and no live phone.
    const replay = directChannel()
    replay.channel.handleRawMessage(helloFrame)
    replay.channel.handleRawMessage(authFrame)
    replay.channel.handleRawMessage(mutationFrame)
    expect(replay.delivered).toHaveLength(1)
    expect(JSON.parse(replay.delivered[0]!).params.data).toBe('rm -rf ~/work\n')
  })

  it('replays and reorders frames within one authenticated session', () => {
    const live = directChannel()
    live.channel.handleRawMessage(helloFrame)
    live.channel.handleRawMessage(authFrame)

    const first = encrypt(JSON.stringify({ seq: 1, method: 'terminal.send', params: { data: 'a' } }), sharedKey)
    const second = encrypt(JSON.stringify({ seq: 2, method: 'terminal.send', params: { data: 'b' } }), sharedKey)

    // Deliver out of order, then duplicate: every frame is accepted.
    live.channel.handleRawMessage(second)
    live.channel.handleRawMessage(first)
    live.channel.handleRawMessage(first)
    expect(live.delivered.map((plaintext) => JSON.parse(plaintext).seq)).toEqual([2, 1, 1])

    // The server's replies are also legacy-framed with random nonces and no counter.
    const reply = live.ws.sent.find((frame) => frame !== '{"type":"e2ee_ready"}')
    expect(reply && decrypt(reply, sharedKey)).toContain('e2ee_authenticated')
  })
})
