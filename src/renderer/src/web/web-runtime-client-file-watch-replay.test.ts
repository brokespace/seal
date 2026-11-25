import { pairedRuntimeConnectionFromOffer } from '../../../shared/remote-runtime/pairing/paired-runtime-connection'
// Replayed watches miss reconnect-gap changes; ready must trigger conservative overflow so consumers rescan.
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import type { PairedE2EEClientHandshake } from '../../../shared/remote-runtime/e2ee/paired-e2ee-client-handshake'
import { createPairedE2EEV2SessionPairForTest } from '../../../main/runtime/rpc/mobile/e2ee/paired-e2ee-v2-session-pair-test-fixture'
import { WebRuntimeClient } from './web-runtime-client'

const fakeSockets: FakeWebSocket[] = []

class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  readyState = FakeWebSocket.CONNECTING
  binaryType = 'arraybuffer'
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  close = vi.fn()
  send = vi.fn()

  constructor(readonly _url: string) {
    fakeSockets.push(this)
  }
}

function keyedHandshake(): PairedE2EEClientHandshake {
  const pair = createPairedE2EEV2SessionPairForTest()
  pair.handshake.acceptReadyText(pair.readyText)
  return pair.handshake
}

describe('WebRuntimeClient file-watch replay resync', () => {
  beforeEach(() => {
    fakeSockets.length = 0
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      atob: (value: string) => Buffer.from(value, 'base64').toString('binary'),
      btoa: (value: string) => Buffer.from(value, 'binary').toString('base64')
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('delivers a conservative overflow after a replayed file watch is ready', async () => {
    const client = new WebRuntimeClient(
      pairedRuntimeConnectionFromOffer({
        v: 2,
        endpoint: 'ws://127.0.0.1:6768',
        deviceToken: 'token',
        publicKeyB64: Buffer.alloc(32, 9).toString('base64')
      })
    )
    const initialSocket = fakeSockets[0]!
    initialSocket.readyState = FakeWebSocket.OPEN
    const onResponse = vi.fn()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the test reaches the client's private transport state; a renamed field fails the test.
    const internals = client as unknown as {
      ws: FakeWebSocket | null
      handshake: PairedE2EEClientHandshake | null
      state: string
      subscriptions: Map<
        string,
        {
          callbacks: { onResponse: typeof onResponse }
          needsReplay: boolean
        }
      >
      setState(next: string): void
    }
    internals.handshake = keyedHandshake()
    internals.state = 'connected'

    await client.subscribe('files.watch', { worktree: 'wt-1' }, { onResponse })
    const [firstId, first] = Array.from(internals.subscriptions.entries())[0]!
    first.callbacks.onResponse({
      id: firstId,
      ok: true,
      streaming: true,
      result: { type: 'ready', subscriptionId: 'sub-1' },
      _meta: { runtimeId: 'runtime-web-test' }
    })
    // Why: an initial ready is not a replay — consumers already scan on setup.
    expect(onResponse).toHaveBeenCalledTimes(1)

    initialSocket.onclose?.()
    const replacementSocket = new FakeWebSocket('ws://127.0.0.1:6768')
    replacementSocket.readyState = FakeWebSocket.OPEN
    internals.ws = replacementSocket
    internals.handshake = keyedHandshake()
    internals.setState('connected')

    const [replacementId, replacement] = Array.from(internals.subscriptions.entries())[0]!
    replacement.callbacks.onResponse({
      id: replacementId,
      ok: true,
      streaming: true,
      result: { type: 'ready', subscriptionId: 'sub-2' },
      _meta: { runtimeId: 'runtime-web-test' }
    })

    // Why: changes during the reconnect gap produced no watch events, so the
    // replayed watch must be followed by an overflow that forces a re-scan.
    expect(onResponse).toHaveBeenCalledTimes(3)
    expect(onResponse.mock.calls[2]![0]).toMatchObject({
      ok: true,
      result: {
        type: 'changed',
        worktree: 'wt-1',
        events: [{ kind: 'overflow' }]
      }
    })
    client.close()
  })

  it('replays an active file watch on reconnect and keeps its logical handle', async () => {
    const client = new WebRuntimeClient(
      pairedRuntimeConnectionFromOffer({
        v: 2,
        endpoint: 'ws://127.0.0.1:6768',
        deviceToken: 'token',
        publicKeyB64: Buffer.alloc(32, 9).toString('base64')
      })
    )
    const initialSocket = fakeSockets[0]!
    initialSocket.readyState = FakeWebSocket.OPEN
    const onResponse = vi.fn()
    const onClose = vi.fn()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the test reaches the client's private transport state; a renamed field fails the test.
    const internals = client as unknown as {
      ws: FakeWebSocket | null
      handshake: PairedE2EEClientHandshake | null
      state: string
      subscriptions: Map<
        string,
        {
          callbacks: { onResponse: typeof onResponse }
          needsReplay: boolean
        }
      >
      setState(next: string): void
      handleSocketClosed(socket: FakeWebSocket): void
    }
    internals.handshake = keyedHandshake()
    internals.state = 'connected'

    const handle = await client.subscribe(
      'files.watch',
      { worktree: 'wt-1' },
      { onResponse, onClose }
    )
    const firstId = Array.from(internals.subscriptions.keys())[0]
    expect(initialSocket.send).toHaveBeenCalledTimes(1)

    initialSocket.onclose?.()

    expect(onClose).not.toHaveBeenCalled()
    expect(internals.subscriptions.get(firstId!)?.needsReplay).toBe(true)

    const replacementSocket = new FakeWebSocket('ws://127.0.0.1:6768')
    replacementSocket.readyState = FakeWebSocket.OPEN
    internals.ws = replacementSocket
    internals.handshake = keyedHandshake()
    internals.setState('connected')

    const [replacementId, replacement] = Array.from(internals.subscriptions.entries())[0]!
    expect(replacementId).not.toBe(firstId)
    expect(replacementSocket.send).toHaveBeenCalledTimes(1)
    replacement.callbacks.onResponse({
      id: replacementId,
      ok: true,
      streaming: true,
      result: { type: 'changed', worktree: 'wt-1', events: [] },
      _meta: { runtimeId: 'runtime-web-test' }
    })
    expect(onResponse).toHaveBeenCalledTimes(1)

    handle.unsubscribe()
    internals.handleSocketClosed(replacementSocket)
    expect(internals.subscriptions.size).toBe(0)
    const secondReplacementSocket = new FakeWebSocket('ws://127.0.0.1:6768')
    secondReplacementSocket.readyState = FakeWebSocket.OPEN
    internals.ws = secondReplacementSocket
    internals.handshake = keyedHandshake()
    internals.setState('connected')
    expect(secondReplacementSocket.send).not.toHaveBeenCalled()
    client.close()
    expect(internals.subscriptions.size).toBe(0)
  })

  it('evicts a failed file-watch setup before reconnect can replay it', async () => {
    const client = new WebRuntimeClient(
      pairedRuntimeConnectionFromOffer({
        v: 2,
        endpoint: 'ws://127.0.0.1:6768',
        deviceToken: 'token',
        publicKeyB64: Buffer.alloc(32, 9).toString('base64')
      })
    )
    const initialSocket = fakeSockets[0]!
    initialSocket.readyState = FakeWebSocket.OPEN
    const pair = createPairedE2EEV2SessionPairForTest()
    pair.handshake.acceptReadyText(pair.readyText)
    const onResponse = vi.fn()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the test reaches the client's private transport state; a renamed field fails the test.
    const internals = client as unknown as {
      ws: FakeWebSocket | null
      handshake: PairedE2EEClientHandshake | null
      state: string
      subscriptions: Map<string, unknown>
      handleSocketMessage(rawData: unknown): Promise<void>
      setState(next: string): void
    }
    internals.handshake = pair.handshake
    internals.state = 'connected'
    await client.subscribe('files.watch', { worktree: 'wt-1' }, { onResponse })
    const subscriptionId = Array.from(internals.subscriptions.keys())[0]!

    await internals.handleSocketMessage(
      pair.host.sealText(
        JSON.stringify({
          id: subscriptionId,
          ok: false,
          error: { code: 'watch_failed', message: 'root unavailable' }
        })
      )
    )

    expect(onResponse).toHaveBeenCalledTimes(1)
    expect(internals.subscriptions.size).toBe(0)
    initialSocket.onclose?.()
    const replacementSocket = new FakeWebSocket('ws://127.0.0.1:6768')
    replacementSocket.readyState = FakeWebSocket.OPEN
    internals.ws = replacementSocket
    internals.handshake = pair.handshake
    internals.setState('connected')
    expect(replacementSocket.send).not.toHaveBeenCalled()
    client.close()
  })
})
