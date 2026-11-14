import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('expo-crypto', () => ({
  getRandomBytes: (length: number) => new Uint8Array(length).fill(9)
}))

vi.mock('../connection/mobile-runtime-capability-negotiation', () => ({
  negotiateMobileRuntimeCapabilities: (args: { onReady: () => void }) => args.onReady()
}))

import { sealMobileE2EEV2Frame } from '../../../../src/shared/remote-runtime/e2ee/mobile-e2ee-v2-framing'
import type { ConnectionLogEntry } from '../../diagnostics/connection/connection-log-types'
import {
  answerMobileE2EEV2HelloForTest,
  TEST_DESKTOP_PUBLIC_KEY_B64
} from '../encryption/mobile-e2ee-v2-desktop-test-peer'
import { connect } from './direct-rpc-connect'

class HostSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSED = 3
  readonly OPEN = HostSocket.OPEN
  readyState = HostSocket.CONNECTING
  bufferedAmount = 0
  onopen: (() => void) | null = null
  onclose: ((event: { code: number }) => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  sent: string[] = []

  constructor() {
    sockets.push(this)
  }

  send(frame: string): void {
    this.sent.push(frame)
  }

  close(): void {
    this.readyState = HostSocket.CLOSED
  }

  open(): void {
    this.readyState = HostSocket.OPEN
    this.onopen?.()
  }

  hostCloses(code: number): void {
    this.readyState = HostSocket.CLOSED
    this.onclose?.({ code })
  }
}

const sockets: HostSocket[] = []
const originalWebSocket = globalThis.WebSocket

function sentHellos(): unknown[] {
  return sockets.flatMap((socket) => socket.sent.map((frame) => JSON.parse(frame)))
}

describe('phone direct socket speaks only forward-secret E2EE v2', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    sockets.length = 0
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the client only uses the socket members HostSocket implements.
    globalThis.WebSocket = HostSocket as unknown as typeof WebSocket
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.WebSocket = originalWebSocket
  })

  it('stops as auth-failed on a host that refuses the hello, and never sends an older one', async () => {
    const log: ConnectionLogEntry[] = []
    const client = connect('ws://desktop.invalid', 'token', TEST_DESKTOP_PUBLIC_KEY_B64, {
      onLog: (entry) => log.push(entry)
    })

    for (let dial = 1; dial <= 3; dial++) {
      const socket = sockets.at(-1)!
      socket.open()
      socket.hostCloses(4001)
      // Step to the redial only: a larger jump would also expire the next socket's connect deadline.
      for (let step = 0; step < 100 && sockets.length === dial && dial < 3; step++) {
        await vi.advanceTimersByTimeAsync(100)
      }
    }

    expect(client.getState()).toBe('auth-failed')
    expect(sockets).toHaveLength(3)
    const hellos = sentHellos()
    expect(hellos).toHaveLength(3)
    for (const hello of hellos) {
      expect(hello).toMatchObject({
        type: 'e2ee_hello',
        v: 2,
        capabilities: { forwardSecrecy: true }
      })
      expect(hello).not.toHaveProperty('publicKeyB64')
    }
    expect(log.map((entry) => entry.message)).toContain('Host refused the encrypted handshake')
    client.close()
  })

  it('refuses a host that answers with the old ready', async () => {
    const client = connect('ws://desktop.invalid', 'token', TEST_DESKTOP_PUBLIC_KEY_B64)
    const socket = sockets[0]!
    socket.open()

    socket.onmessage?.({ data: JSON.stringify({ type: 'e2ee_ready' }) })
    await vi.advanceTimersByTimeAsync(0)

    expect(client.getState()).toBe('reconnecting')
    expect(socket.sent).toHaveLength(1)
    expect(socket.readyState).toBe(HostSocket.CLOSED)
    client.close()
  })

  it('connects to a host that answers with a per-session key', async () => {
    const client = connect('ws://desktop.invalid', 'token', TEST_DESKTOP_PUBLIC_KEY_B64)
    const socket = sockets[0]!
    socket.open()
    const { ready, schedule } = answerMobileE2EEV2HelloForTest(JSON.parse(socket.sent[0]!))

    socket.onmessage?.({ data: JSON.stringify(ready) })
    await vi.advanceTimersByTimeAsync(0)
    const authenticated = sealMobileE2EEV2Frame({
      payload: new TextEncoder().encode(
        JSON.stringify({
          type: 'e2ee_authenticated',
          v: 2,
          transcriptHashB64: Buffer.from(schedule.transcriptHash).toString('base64')
        })
      ),
      key: schedule.desktopToMobileKey,
      sessionId: schedule.sessionId,
      direction: 'desktop-to-mobile',
      payloadKind: 'text',
      counter: 0n
    })
    socket.onmessage?.({ data: Buffer.from(authenticated).toString('base64') })
    await vi.advanceTimersByTimeAsync(0)

    expect(client.getState()).toBe('connected')
    client.close()
  })
})
