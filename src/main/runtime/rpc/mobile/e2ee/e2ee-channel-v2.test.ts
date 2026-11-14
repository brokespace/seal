import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import nacl from 'tweetnacl'
import type { WebSocket } from 'ws'
import {
  encodeMobileE2EEV2Transcript,
  validateMobileE2EEV2Handshake,
  type MobileE2EEV2Hello,
  type MobileE2EEV2Ready
} from '../../../../../shared/remote-runtime/e2ee/mobile-e2ee-v2-contract'
import {
  openMobileE2EEV2Frame,
  sealMobileE2EEV2Frame
} from '../../../../../shared/remote-runtime/e2ee/mobile-e2ee-v2-framing'
import {
  COMPRESSED_FRAMES_CLIENT_CAPABILITY,
  inflateCompressedFrame
} from '../../../../../shared/remote-runtime/e2ee/paired-e2ee-compressed-frame'
import { NODE_COMPRESSED_FRAME_CODEC } from '../../../../../shared/remote-runtime/e2ee/node/paired-e2ee-node-compressed-frame'
import type { RpcBinarySendResult } from '../../transports/rpc-binary-sender'
import { E2EEChannel } from './e2ee-channel'
import { deriveMobileE2EEV2KeySchedule } from '../../../../../shared/remote-runtime/e2ee/node/mobile-e2ee-v2-node-key-schedule'

const server = nacl.box.keyPair.fromSecretKey(new Uint8Array(32).fill(1))
const client = nacl.box.keyPair.fromSecretKey(new Uint8Array(32).fill(2))

function createMockWs() {
  const sent: { data: string | Buffer; options?: { binary?: boolean } }[] = []
  return {
    OPEN: 1 as const,
    readyState: 1,
    bufferedAmount: 0,
    send: vi.fn((data: string | Buffer, options?: { binary?: boolean }) => {
      sent.push({ data, options })
    }),
    sent
  }
}

type Transport = 'relay' | 'direct'

function hello(transport: Transport = 'relay'): MobileE2EEV2Hello {
  return {
    type: 'e2ee_hello',
    v: 2,
    clientPublicKeyB64: Buffer.from(client.publicKey).toString('base64'),
    clientNonceB64: Buffer.from(new Uint8Array(32).fill(3)).toString('base64'),
    capabilities: { framing: [2], payloadKinds: ['text', 'binary'], forwardSecrecy: true },
    context: {
      protocol: 'orca-mobile-e2ee',
      initiator: 'mobile',
      responder: 'desktop',
      transport,
      ...(transport === 'relay' ? { relayHostId: 'AbCdEf0123_-xyZ9' } : {})
    }
  }
}

function setup(transport: Transport = 'relay') {
  const ws = createMockWs()
  const onReady = vi.fn()
  const onError = vi.fn()
  const resolveAuthenticatedDevice = vi.fn((token: string) =>
    token === 'valid-token'
      ? {
          deviceId: 'device-1',
          deviceToken: token,
          scope: 'mobile' as const,
          clientId: token,
          callerFingerprint: 'test-fingerprint',
          credentialRevision: 0
        }
      : null
  )
  const channel = new E2EEChannel(ws as unknown as WebSocket, {
    serverSecretKey: server.secretKey,
    resolveAuthenticatedDevice,
    onReady,
    onError,
    transportContext:
      transport === 'relay' ? { transport, relayHostId: 'AbCdEf0123_-xyZ9' } : { transport }
  })
  return { ws, channel, onReady, onError, resolveAuthenticatedDevice, transport }
}

function startV2(ctx: ReturnType<typeof setup>) {
  const clientHello = hello(ctx.transport)
  ctx.channel.handleRawMessage(JSON.stringify(clientHello))
  const ready = JSON.parse(ctx.ws.sent[0]!.data.toString()) as MobileE2EEV2Ready
  const handshake = validateMobileE2EEV2Handshake(clientHello, ready)!
  const schedule = deriveMobileE2EEV2KeySchedule({
    staticSharedSecret: nacl.scalarMult(client.secretKey, server.publicKey),
    ephemeralSharedSecret: nacl.scalarMult(client.secretKey, handshake.desktopEphemeralPublicKey),
    transcript: encodeMobileE2EEV2Transcript(handshake),
    clientNonce: handshake.clientNonce,
    desktopNonce: handshake.desktopNonce
  })
  return { ready, schedule, handshake }
}

function clientText(
  plaintext: string,
  schedule: ReturnType<typeof startV2>['schedule'],
  counter: bigint
): string {
  const frame = sealMobileE2EEV2Frame({
    payload: new TextEncoder().encode(plaintext),
    key: schedule.mobileToDesktopKey,
    sessionId: schedule.sessionId,
    direction: 'mobile-to-desktop',
    payloadKind: 'text',
    counter
  })
  return Buffer.from(frame).toString('base64')
}

function openServerFrame(
  frame: string | Buffer,
  kind: 'text' | 'binary',
  schedule: ReturnType<typeof startV2>['schedule'],
  counter: bigint
): Uint8Array | null {
  return openMobileE2EEV2Frame({
    frame: typeof frame === 'string' ? Buffer.from(frame, 'base64') : frame,
    key: schedule.desktopToMobileKey,
    sessionId: schedule.sessionId,
    direction: 'desktop-to-mobile',
    payloadKind: kind,
    expectedCounter: counter
  })
}

function authenticate(
  ctx: ReturnType<typeof setup>,
  schedule: ReturnType<typeof startV2>['schedule'],
  clientCapabilities?: readonly string[]
) {
  const transcriptHashB64 = Buffer.from(schedule.transcriptHash).toString('base64')
  ctx.channel.handleRawMessage(
    clientText(
      JSON.stringify({
        type: 'e2ee_auth',
        v: 2,
        transcriptHashB64,
        deviceToken: 'valid-token',
        ...(clientCapabilities ? { clientCapabilities } : {})
      }),
      schedule,
      0n
    )
  )
}

describe('E2EEChannel v2', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('rejects a captured authenticated mutating trace on a fresh socket', () => {
    const first = setup()
    const firstHandshake = startV2(first)
    const transcriptHashB64 = Buffer.from(firstHandshake.schedule.transcriptHash).toString('base64')
    const capturedAuth = clientText(
      JSON.stringify({ type: 'e2ee_auth', v: 2, transcriptHashB64, deviceToken: 'valid-token' }),
      firstHandshake.schedule,
      0n
    )
    const capturedMutation = clientText(
      JSON.stringify({ method: 'device.remove', params: { deviceId: 'device-1' } }),
      firstHandshake.schedule,
      1n
    )
    const firstMutation = vi.fn()
    first.channel.onMessage(firstMutation)
    first.channel.handleRawMessage(capturedAuth)
    first.channel.handleRawMessage(capturedMutation)
    expect(firstMutation).toHaveBeenCalledOnce()

    const second = setup()
    startV2(second)
    const replayedMutation = vi.fn()
    second.channel.onMessage(replayedMutation)
    second.channel.handleRawMessage(capturedAuth)
    second.channel.handleRawMessage(capturedMutation)
    expect(second.resolveAuthenticatedDevice).not.toHaveBeenCalled()
    expect(replayedMutation).not.toHaveBeenCalled()
  })

  it('preserves one queued counter order across text and binary replies', () => {
    const ctx = setup()
    const { schedule } = startV2(ctx)
    authenticate(ctx, schedule)
    ctx.ws.bufferedAmount = 9 * 1024 * 1024
    ctx.channel.onMessage((_request, textReply, binaryReply) => {
      textReply('one')
      binaryReply(new Uint8Array([2]))
    })
    ctx.channel.handleRawMessage(clientText('{"method":"status.get"}', schedule, 1n))
    expect(ctx.ws.sent).toHaveLength(2)

    ctx.ws.bufferedAmount = 0
    vi.runOnlyPendingTimers()
    expect(
      new TextDecoder().decode(openServerFrame(ctx.ws.sent[2]!.data, 'text', schedule, 1n)!)
    ).toBe('one')
    expect(openServerFrame(ctx.ws.sent[3]!.data, 'binary', schedule, 2n)).toEqual(
      new Uint8Array([2])
    )
    expect(ctx.ws.sent[3]!.options).toEqual({ binary: true })
  })

  it('drops a backlogged lossy binary reply without spending a counter, then sends once drained', () => {
    const ctx = setup()
    const { schedule } = startV2(ctx)
    authenticate(ctx, schedule)
    ctx.ws.bufferedAmount = 9 * 1024 * 1024
    const accepted: RpcBinarySendResult[] = []
    ctx.channel.onMessage((_request, _textReply, binaryReply) => {
      accepted.push(binaryReply(new Uint8Array([1]), { dropWhenBacklogged: true }))
    })
    ctx.channel.handleRawMessage(clientText('{"method":"browser.screencast"}', schedule, 1n))
    ctx.ws.bufferedAmount = 0
    vi.runOnlyPendingTimers()
    expect(ctx.ws.sent).toHaveLength(2)

    ctx.channel.handleRawMessage(clientText('{"method":"browser.screencast"}', schedule, 2n))
    expect(accepted).toEqual(['backlogged', true])
    expect(openServerFrame(ctx.ws.sent[2]!.data, 'binary', schedule, 1n)).toEqual(
      new Uint8Array([1])
    )
  })

  it.each(['direct', 'relay'] as const)(
    'closes a %s socket whose hello is not v2 without answering it',
    (transport) => {
      const legacyHellos = [
        { type: 'e2ee_hello', publicKeyB64: Buffer.from(client.publicKey).toString('base64') },
        { ...hello(transport), v: 1 }
      ]
      for (const legacyHello of legacyHellos) {
        const ctx = setup(transport)
        ctx.channel.handleRawMessage(JSON.stringify(legacyHello))
        expect(ctx.onError).toHaveBeenCalledWith(4001, 'E2EE v2 required')
        expect(ctx.ws.sent).toHaveLength(0)
        expect(ctx.onReady).not.toHaveBeenCalled()
      }
    }
  )

  it('refuses a v2 hello that does not ask for forward secrecy', () => {
    const ctx = setup('direct')
    const { forwardSecrecy: _forwardSecrecy, ...capabilities } = hello('direct').capabilities
    ctx.channel.handleRawMessage(JSON.stringify({ ...hello('direct'), capabilities }))
    expect(ctx.onError).toHaveBeenCalledWith(4001, 'Invalid e2ee_hello v2')
    expect(ctx.ws.sent).toHaveLength(0)
  })

  it('refuses a hello whose client key is a low-order point', () => {
    const ctx = setup('direct')
    ctx.channel.handleRawMessage(
      JSON.stringify({
        ...hello('direct'),
        // An order-8 point: its X25519 output is all zeros for every host key.
        clientPublicKeyB64: 'X5yVvKNQjCSx0LFVnIPvWwREXMRYHI6G2CJO3dCfEVc='
      })
    )
    expect(ctx.onError).toHaveBeenCalledWith(4001, 'Invalid e2ee_hello v2')
    expect(ctx.ws.sent).toHaveLength(0)
  })

  it('keys each socket with a fresh host key that the host static secret cannot recover', () => {
    const first = setup()
    const second = setup()
    const firstStart = startV2(first)
    const secondStart = startV2(second)
    expect(firstStart.ready.desktopEphemeralPublicKeyB64).not.toBe(
      secondStart.ready.desktopEphemeralPublicKeyB64
    )

    authenticate(first, firstStart.schedule)
    const recorded = first.ws.sent[1]!.data
    expect(openServerFrame(recorded, 'text', firstStart.schedule, 0n)).not.toBeNull()

    // Everything a later thief of the host static secret has: that secret and the recorded handshake.
    const staticOnly = nacl.scalarMult(server.secretKey, client.publicKey)
    const thiefSchedule = deriveMobileE2EEV2KeySchedule({
      staticSharedSecret: staticOnly,
      ephemeralSharedSecret: nacl.scalarMult(
        server.secretKey,
        firstStart.handshake.desktopEphemeralPublicKey
      ),
      transcript: encodeMobileE2EEV2Transcript(firstStart.handshake),
      clientNonce: firstStart.handshake.clientNonce,
      desktopNonce: firstStart.handshake.desktopNonce
    })
    expect(openServerFrame(recorded, 'text', thiefSchedule, 0n)).toBeNull()
  })

  it('compresses replies to listed bulk methods only, never credential replies or control frames', () => {
    const ctx = setup('direct')
    const { schedule } = startV2(ctx)
    authenticate(ctx, schedule, [COMPRESSED_FRAMES_CLIENT_CAPABILITY])
    const authenticated = ctx.ws.sent[1]!
    expect(typeof authenticated.data).toBe('string')

    const bulk = JSON.stringify({ token: 'secret-token', filler: 'a'.repeat(4096) })
    ctx.channel.onMessage((_request, textReply) => textReply(bulk))

    ctx.channel.handleRawMessage(
      clientText('{"id":"1","method":"seal.accounts.exportCredential"}', schedule, 1n)
    )
    const credentialReply = ctx.ws.sent[2]!
    expect(typeof credentialReply.data).toBe('string')
    expect(
      new TextDecoder().decode(openServerFrame(credentialReply.data, 'text', schedule, 1n)!)
    ).toBe(bulk)

    ctx.channel.handleRawMessage(clientText('{"id":"2","method":"terminal.read"}', schedule, 2n))
    const terminalReply = ctx.ws.sent[3]!
    expect(terminalReply.options).toEqual({ binary: true })
    const inflated = inflateCompressedFrame(
      openServerFrame(terminalReply.data, 'binary', schedule, 2n)!,
      NODE_COMPRESSED_FRAME_CODEC
    )
    expect(inflated).toEqual({ kind: 'text', text: bulk })
    expect(terminalReply.data.length).toBeLessThan(1024)
  })
})
