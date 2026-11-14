import { pairedRuntimeConnectionFromOffer } from '../pairing/paired-runtime-connection'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import type { PairingOffer } from '../pairing/mobile-relay-pairing-offer'
import {
  createPairedE2EEV2SessionPairForTest,
  type PairedE2EEV2SessionPair
} from '../../../main/runtime/rpc/mobile/e2ee/paired-e2ee-v2-session-pair-test-fixture'
import { getRemoteRuntimeRequestAdmissionEvidence } from './remote-runtime-prepared-request-admission'
import type { RemoteRuntimeWebSocketCallbacks } from './remote-runtime-request-websocket'

const opens: FakeOpenedSocket[] = []

vi.mock('./remote-runtime-request-websocket', () => ({
  openRemoteRuntimeWebSocket: (
    _pairing: PairingOffer,
    callbacks: RemoteRuntimeWebSocketCallbacks
  ) => {
    const socket = createFakeOpenedSocket(callbacks)
    opens.push(socket)
    return {
      ok: true,
      socket: {
        ws: socket.ws,
        handshake: socket.pair.handshake,
        cleanup: socket.cleanup
      }
    }
  }
}))

type FakeOpenedSocket = {
  ws: WebSocket
  pair: PairedE2EEV2SessionPair
  cleanup: ReturnType<typeof vi.fn>
  sent: string[]
  callbacks: RemoteRuntimeWebSocketCallbacks
}

function createFakeOpenedSocket(callbacks: RemoteRuntimeWebSocketCallbacks): FakeOpenedSocket {
  const sent: string[] = []
  const ws = {
    readyState: WebSocket.OPEN,
    send: (frame: string) => {
      sent.push(frame)
    },
    close: vi.fn()
  } as unknown as WebSocket
  return {
    ws,
    pair: createPairedE2EEV2SessionPairForTest(),
    cleanup: vi.fn(),
    sent,
    callbacks
  }
}

async function authenticate(
  socket: FakeOpenedSocket,
  beforeAuthenticated?: () => void
): Promise<void> {
  socket.callbacks.onFrame(socket.ws, socket.pair.readyText)
  // The auth step is async; a host answers only after the auth frame is on the wire.
  for (let tick = 0; tick < 20 && socket.sent.length === 0; tick++) {
    await Promise.resolve()
  }
  expect(socket.sent).toHaveLength(1)
  // The host opens frames in order, so the auth frame goes first.
  expect(socket.pair.host.openText(socket.sent[0]!)).not.toBeNull()
  beforeAuthenticated?.()
  socket.callbacks.onFrame(socket.ws, socket.pair.authenticatedText())
}

function firstRequestId(socket: FakeOpenedSocket): string {
  const plaintext = socket.pair.host.openText(socket.sent[1] ?? '')
  if (plaintext === null) {
    throw new Error('missing encrypted request')
  }
  return (JSON.parse(plaintext) as { id: string }).id
}

describe('RemoteRuntimeRequestConnection stale socket callbacks', () => {
  beforeEach(() => {
    opens.splice(0)
  })

  it('releases a pending request when the cached socket send throws', async () => {
    const { RemoteRuntimeRequestConnection } =
      await import('./remote-runtime-request-connection.js')
    const connection = new RemoteRuntimeRequestConnection(
      pairedRuntimeConnectionFromOffer({
        v: 2,
        endpoint: 'ws://127.0.0.1:6768',
        deviceToken: 'device-token',
        publicKeyB64: Buffer.from(new Uint8Array(32).fill(9)).toString('base64')
      })
    )
    const request = connection.request('status.get', undefined, 1000)
    const socket = opens[0]!
    await authenticate(socket, () => {
      socket.ws.send = (() => {
        throw new Error('send failed')
      }) as WebSocket['send']
    })

    await expect(request).rejects.toThrow('send failed')
    expect(
      (connection as unknown as { pendingRequests: Map<string, unknown> }).pendingRequests.size
    ).toBe(0)
    expect(getRemoteRuntimeRequestAdmissionEvidence()).toEqual({
      pendingRequestCount: 0,
      retainedBytes: 0
    })
    connection.close()
  })

  it('ignores stale socket errors and text frames after a replacement socket opens', async () => {
    vi.useFakeTimers()
    try {
      const { RemoteRuntimeRequestConnection } =
        await import('./remote-runtime-request-connection.js')
      const connection = new RemoteRuntimeRequestConnection(
        pairedRuntimeConnectionFromOffer({
          v: 2,
          endpoint: 'ws://127.0.0.1:6768',
          deviceToken: 'device-token',
          publicKeyB64: Buffer.from(new Uint8Array(32).fill(9)).toString('base64')
        })
      )

      const first = connection.request('slow.method', undefined, 10)
      await authenticate(opens[0]!)
      const firstRejected = expect(first).rejects.toThrow('Timed out')
      await vi.advanceTimersByTimeAsync(11)
      await firstRejected
      expect(getRemoteRuntimeRequestAdmissionEvidence()).toEqual({
        pendingRequestCount: 0,
        retainedBytes: 0
      })

      const second = connection.request('status.get', undefined, 1000)
      await authenticate(opens[1]!)
      await vi.waitFor(() => expect(opens[1]!.sent.length).toBeGreaterThan(1))

      opens[0]!.callbacks.onError(opens[0]!.ws, new Error('stale socket error') as never)
      opens[0]!.callbacks.onFrame(
        opens[0]!.ws,
        opens[0]!.pair.host.sealText(JSON.stringify({ id: 'stale', ok: true, result: {} }))
      )

      const requestId = firstRequestId(opens[1]!)
      opens[1]!.callbacks.onFrame(
        opens[1]!.ws,
        opens[1]!.pair.host.sealText(
          JSON.stringify({
            id: requestId,
            ok: true,
            result: { state: 'ok' },
            _meta: { runtimeId: 'runtime-2' }
          })
        )
      )

      await expect(second).resolves.toMatchObject({
        ok: true,
        result: { state: 'ok' }
      })
      expect(getRemoteRuntimeRequestAdmissionEvidence()).toEqual({
        pendingRequestCount: 0,
        retainedBytes: 0
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
