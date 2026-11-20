import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebSocket } from 'ws'
import { BROWSER_SCREENCAST_GHOST_SUBSCRIBER_REFUSAL_LIMIT } from './browser-screencast-ghost-subscriber-eviction'
import { SCREENCAST_PENDING_FRAME_RETRY_MS } from './browser-screencast-subscriber-frame-delivery'
import {
  createSinglePageBrowserCommandsHost,
  createStreamedGuest
} from '../client-pages/single-page-browser-commands-host-test-double'
import { E2EEChannel } from '../../rpc/mobile/e2ee/e2ee-channel'
import {
  createPairedE2EEClientHandshake,
  pairedE2EEV2TokenAuth
} from '../../../../shared/remote-runtime/e2ee/paired-e2ee-client-handshake'
import {
  generateKeyPair,
  publicKeyToBase64
} from '../../../../shared/remote-runtime/e2ee/node/e2ee-crypto'
import { NODE_PAIRED_E2EE_PRIMITIVES } from '../../../../shared/remote-runtime/e2ee/node/paired-e2ee-node-primitives'
import type { RpcBinarySender } from '../../rpc/transports/rpc-binary-sender'

const { webContentsFromId, startBrowserScreencast } = vi.hoisted(() => ({
  webContentsFromId: vi.fn(),
  startBrowserScreencast: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  webContents: { fromId: webContentsFromId }
}))
vi.mock('../../../browser/cdp/screencast/browser-screencast-stream', () => ({
  startBrowserScreencast
}))
vi.mock('../../../telemetry/client', () => ({ track: vi.fn() }))

function connectChannel() {
  const serverKeys = generateKeyPair()
  const sent: (string | Buffer)[] = []
  const ws = {
    OPEN: 1 as const,
    readyState: 1,
    bufferedAmount: 0,
    send: vi.fn((data: string | Buffer) => sent.push(data)),
    close: vi.fn()
  }
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
    onError
  })
  const client = createPairedE2EEClientHandshake({
    primitives: NODE_PAIRED_E2EE_PRIMITIVES,
    hostPublicKeyB64: publicKeyToBase64(serverKeys.publicKey),
    transport: 'direct'
  })
  channel.handleRawMessage(client.helloText())
  client.acceptReadyText(String(sent[0]))
  channel.handleRawMessage(
    client.channel.sealText(
      JSON.stringify(pairedE2EEV2TokenAuth(client.transcriptHashB64()!, 'valid-token'))
    )
  )
  let reply!: (response: string) => void
  let sendBinary!: RpcBinarySender
  channel.onMessage((_plaintext, textReply, binaryReply) => {
    reply = textReply
    sendBinary = binaryReply
  })
  channel.handleRawMessage(client.channel.sealText('{"id":"s","method":"browser.screencast"}'))
  // Frames open once, in the order the host sealed them.
  const decode = (frame: string | Buffer): string =>
    typeof frame === 'string'
      ? client.channel.openText(frame)!
      : `binary:${Buffer.from(client.channel.openBinary(new Uint8Array(frame))!).join(',')}`
  return { ws, sent, onError, reply, sendBinary, decode, channel }
}

async function subscribe(sendBinary: RpcBinarySender) {
  const { RuntimeBrowserCommands } = await import('../commands/browser-commands')
  let resolveDone!: () => void
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve
  })
  const stop = vi.fn(() => resolveDone())
  startBrowserScreencast.mockResolvedValue({ stop, done, updateViewport: vi.fn(async () => {}) })
  const commands = new RuntimeBrowserCommands(createSinglePageBrowserCommandsHost())
  const subscription = await commands.browserScreencast(
    { worktree: 'id:wt-1', page: 'page-1', format: 'jpeg' },
    { sendBinary }
  )
  const onFrame: (bytes: Uint8Array<ArrayBufferLike>) => unknown =
    startBrowserScreencast.mock.calls[0][1].onFrame
  return { subscription, onFrame, stop }
}

describe('screencast over a backlogged E2EE socket', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    webContentsFromId.mockReset()
    webContentsFromId.mockReturnValue(createStreamedGuest())
    startBrowserScreencast.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  // Backlogged sockets remain live; ghost eviction would blank working phones.
  it('keeps the viewer through a long backlog and then delivers only the newest frame', async () => {
    const transport = connectChannel()
    const { subscription, onFrame, stop } = await subscribe(transport.sendBinary)
    onFrame(new Uint8Array([0]))
    const baseline = transport.sent.length

    transport.ws.bufferedAmount = 9 * 1024 * 1024
    transport.reply('{"parked":true}')
    const frameCount = BROWSER_SCREENCAST_GHOST_SUBSCRIBER_REFUSAL_LIMIT + 10
    for (let frame = 1; frame <= frameCount; frame++) {
      onFrame(new Uint8Array([frame]))
    }
    expect(stop).not.toHaveBeenCalled()
    expect(transport.sent.length).toBe(baseline)

    transport.ws.bufferedAmount = 0
    await vi.advanceTimersByTimeAsync(SCREENCAST_PENDING_FRAME_RETRY_MS * 2)
    // sent[0] is the plaintext ready; every later frame must be opened to reach the newest.
    const opened = transport.sent.slice(1).map(transport.decode)
    expect(opened.slice(baseline - 1)).toEqual(['{"parked":true}', `binary:${frameCount}`])
    expect(transport.onError).not.toHaveBeenCalled()
    subscription.session.stop()
    transport.channel.destroy()
  })
})
