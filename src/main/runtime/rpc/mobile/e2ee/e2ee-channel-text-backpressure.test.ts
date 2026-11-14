import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebSocket } from 'ws'
import { E2EEChannel, type E2EEChannelOptions } from './e2ee-channel'
import {
  createPairedE2EEClientHandshake,
  pairedE2EEV2TokenAuth
} from '../../../../../shared/remote-runtime/e2ee/paired-e2ee-client-handshake'
import {
  generateKeyPair,
  publicKeyToBase64
} from '../../../../../shared/remote-runtime/e2ee/node/e2ee-crypto'
import { NODE_PAIRED_E2EE_PRIMITIVES } from '../../../../../shared/remote-runtime/e2ee/node/paired-e2ee-node-primitives'
import { createMobileE2EEOutboundMemoryBudget } from './mobile-e2ee-outbound-memory-budget'

const trackMock = vi.hoisted(() => vi.fn())

vi.mock('../../../../telemetry/client', () => ({ track: trackMock }))

function createMockWs() {
  const sent: (string | Buffer)[] = []
  return {
    OPEN: 1 as const,
    readyState: 1,
    bufferedAmount: 0,
    send: vi.fn((data: string | Buffer) => {
      sent.push(data)
    }),
    close: vi.fn(),
    sent
  }
}

function setup(overrides?: Partial<E2EEChannelOptions>) {
  const serverKeys = generateKeyPair()
  const ws = createMockWs()
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
            callerFingerprint: 'test-fingerprint',
            credentialRevision: 0
          }
        : null,
    onReady: vi.fn(),
    onError,
    ...overrides
  })
  const client = createPairedE2EEClientHandshake({
    primitives: NODE_PAIRED_E2EE_PRIMITIVES,
    hostPublicKeyB64: publicKeyToBase64(serverKeys.publicKey),
    transport: 'direct'
  })
  channel.handleRawMessage(client.helloText())
  client.acceptReadyText(String(ws.sent[0]))
  channel.handleRawMessage(
    client.channel.sealText(
      JSON.stringify(pairedE2EEV2TokenAuth(client.transcriptHashB64()!, 'valid-token'))
    )
  )
  return { channel, ws, client, onError }
}

function emitReply(ctx: ReturnType<typeof setup>, payload: string): void {
  ctx.channel.onMessage((_plaintext, encryptedReply) => {
    encryptedReply(payload)
  })
  ctx.channel.handleRawMessage(ctx.client.channel.sealText('{"id":"x","method":"status.get"}'))
}

describe('E2EE text reply backpressure', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    trackMock.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('rejects aggregate queue growth across independently backpressured sockets', () => {
    const outboundMemoryBudget = createMobileE2EEOutboundMemoryBudget({
      maxBufferedBytes: 1_000,
      maxQueuedBytes: 150,
      maxQueuedFrames: 10
    })
    const first = setup({ outboundMemoryBudget })
    const second = setup({ outboundMemoryBudget })
    first.ws.bufferedAmount = 1_001
    second.ws.bufferedAmount = 1_001

    emitReply(first, 'x'.repeat(40))
    emitReply(second, 'x'.repeat(40))

    expect(first.onError).not.toHaveBeenCalled()
    expect(second.onError).toHaveBeenCalledWith(1013, 'Outbound reply buffer overflow')
    expect(trackMock).toHaveBeenCalledWith('remote_outbound_budget_close', {
      emitter: 'queue'
    })
    first.channel.destroy()
    expect(outboundMemoryBudget.evidence().queuedBytes).toBe(0)
  })
})
