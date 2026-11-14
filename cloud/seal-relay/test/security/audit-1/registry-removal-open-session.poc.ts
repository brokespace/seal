// Audit 1, A1-04: after an operator removes a paired device's row from orca-devices.json, a socket
// that device already had open keeps receiving host-pushed terminal output for as long as it sends
// no application frame. Real headless RPC server on loopback with a stub PTY; pairings made here.
import type * as WorktreeScanCacheModule from '../../../../../src/main/git/worktrees/catalog/worktree-scan-cache'
import type * as WorktreeListingModule from '../../../../../src/main/git/worktrees/catalog/worktree-listing'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { pairedRuntimeConnectionFromOffer } from '../../../../../src/shared/remote-runtime/pairing/paired-runtime-connection'
import { parsePairingCode } from '../../../../../src/shared/remote-runtime/pairing/pairing'
import '../../../../../src/shared/remote-runtime/requests/remote-runtime-request-socket'
import { subscribeRemoteRuntimeTransport } from '../../../../../src/shared/remote-runtime/requests/remote-runtime-subscription-transport'
import type { RemoteRuntimeTransportSubscription } from '../../../../../src/shared/remote-runtime/requests/remote-runtime-subscription-contract'
import {
  TerminalStreamOpcode,
  decodeTerminalStreamFrame,
  decodeTerminalStreamText,
  encodeTerminalStreamFrame,
  encodeTerminalStreamJson,
  encodeTerminalStreamText
} from '../../../../../src/shared/terminal/stream/terminal-stream-protocol'
import { OrcaRuntimeService } from '../../../../../src/main/runtime/orca-runtime'
import { OrcaRuntimeRpcServer } from '../../../../../src/main/runtime/rpc/server/runtime-rpc'
import { readRuntimeMetadata } from '../../../../../src/main/runtime/rpc/server/runtime-metadata'
import { sendRequest } from '../../../../../src/main/runtime/rpc/server/runtime-rpc-test-harness'
import { makeStore } from '../../../../../src/main/runtime/rpc/server/runtime-rpc-worktree-store-fixtures'
import { partialRuntimeStore } from '../../../../../src/main/runtime/orca-runtime-tests/runtime-store-partial-fixture'
import { settledWriteStub } from '../../../../../src/main/providers/testing/settled-pty-write-stub'
import { publishHeadlessRuntimeGraph } from '../../../../../src/main/runtime/session-graph/headless-runtime-graph'
import { committingSpawn } from '../../../../../src/main/runtime/orca-runtime-tests/bind-first-pane.test-fixture'
import { DEVICE_REGISTRY_FILENAME } from '../../../../../src/main/runtime/rpc/server/pairing/mobile-pairing-files'
import { describePoc } from './security-poc-opt-in'

vi.mock(
  '../../../../../src/main/git/worktrees/catalog/worktree-scan-cache',
  async (importOriginal) => ({
    ...(await importOriginal<typeof WorktreeScanCacheModule>()),
    listWorktrees: getWorktreeListingMocks().listWorktrees
  })
)

vi.mock(
  '../../../../../src/main/git/worktrees/catalog/worktree-listing',
  async (importOriginal) => ({
    ...(await importOriginal<typeof WorktreeListingModule>()),
    listWorktreesStrict: getWorktreeListingMocks().listWorktreesStrict
  })
)

const { getWorktreeListingMocks } = vi.hoisted(() => {
  const worktrees = [
    { path: '/tmp/worktree-a', head: 'abc', branch: 'a', isBare: false, isMainWorktree: false }
  ]
  const listings = {
    listWorktrees: vi.fn().mockResolvedValue(worktrees),
    listWorktreesStrict: vi.fn().mockResolvedValue(worktrees)
  }
  return { getWorktreeListingMocks: () => listings }
})

const PTY_ID = 'shared-pty'
const SPAWN = { cols: 80, rows: 24 }
const WORKTREE = 'id:repo-1::/tmp/worktree-a'
const SLOW_WAIT = { timeout: 20_000, interval: 50 }
// Longer than three 15 s server heartbeat sweeps, the point at which an unresponsive socket is reaped.
const HEARTBEAT_SPAN_MS = 50_000
const FLOOD_CHUNKS = 48
const FLOOD_CHUNK_BYTES = 56 * 1024

type StreamResponse = { type?: string; streamId?: number }

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let attachCount = 0

// Subscribes without the ackOutput capability, so the host needs no acknowledgements to keep sending.
async function attach(pairingUrl: string, terminal: string) {
  const pairing = parsePairingCode(pairingUrl)!
  const streamId = 7
  const responses: StreamResponse[] = []
  const errors: unknown[] = []
  let closed = false
  let outputBytes = 0
  let outputText = ''
  const subscription: RemoteRuntimeTransportSubscription = await subscribeRemoteRuntimeTransport(
    pairedRuntimeConnectionFromOffer(pairing),
    'terminal.multiplex',
    {},
    15_000,
    {
      onResponse: (response) => {
        responses.push(response.ok ? ((response.result ?? {}) as StreamResponse) : {})
      },
      onBinary: (bytes) => {
        const frame = decodeTerminalStreamFrame(bytes)
        if (frame?.opcode === TerminalStreamOpcode.Output && frame.streamId === streamId) {
          outputBytes += frame.payload.byteLength
          outputText += decodeTerminalStreamText(frame.payload)
        }
      },
      onError: (error) => errors.push(error),
      onClose: () => {
        closed = true
      }
    }
  )
  await vi.waitFor(() => expect(responses.some((r) => r.type === 'ready')).toBe(true), SLOW_WAIT)
  let controlSeq = 0
  let inputSeq = 0
  const inputSessionId = `audit-1-input-session-${++attachCount}`
  const frame = (opcode: TerminalStreamOpcode, payload: Uint8Array, seq = 0) =>
    subscription.sendBinary(
      encodeTerminalStreamFrame({
        opcode,
        streamId: opcode === TerminalStreamOpcode.Subscribe ? 0 : streamId,
        seq,
        payload
      })
    )
  frame(
    TerminalStreamOpcode.Subscribe,
    encodeTerminalStreamJson({
      streamId,
      terminal,
      // The shipped phone app uses its device token as the terminal client id.
      client: { id: pairing.deviceToken, type: 'mobile' },
      viewport: { cols: 80, rows: 24 },
      capabilities: {},
      inputSessionId
    }),
    ++controlSeq
  )
  await vi.waitFor(
    () =>
      expect(responses.some((r) => r.type === 'subscribed' && r.streamId === streamId)).toBe(true),
    SLOW_WAIT
  )
  return {
    isClosed: () => closed || errors.length > 0,
    outputBytes: () => outputBytes,
    output: () => outputText,
    type: (text: string) =>
      frame(TerminalStreamOpcode.Input, encodeTerminalStreamText(text), ++inputSeq),
    close: () => subscription.close()
  }
}

describePoc('audit 1 A1-04: registry removal versus open sessions on a headless host', () => {
  const cleanups: (() => unknown)[] = []
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).toReversed()) {
      await cleanup()
    }
  })

  async function start() {
    const userDataPath = mkdtempSync(join(tmpdir(), 'seal-audit-1-host-'))
    cleanups.push(() => rmSync(userDataPath, { recursive: true, force: true }))
    const writes: string[] = []
    const runtime = new OrcaRuntimeService(partialRuntimeStore(makeStore()))
    runtime.setPtyController({
      spawn: committingSpawn(runtime, vi.fn().mockResolvedValue({ id: PTY_ID })),
      write: (_ptyId, data) => {
        writes.push(data)
        return true
      },
      writeWithSettlement: settledWriteStub((_ptyId, data) => {
        writes.push(data)
      }),
      resize: () => true,
      kill: () => true,
      getForegroundProcess: async () => null
    })
    publishHeadlessRuntimeGraph(runtime)
    const server = new OrcaRuntimeRpcServer({
      runtime,
      userDataPath,
      enableWebSocket: true,
      wsPort: 0
    })
    await server.start()
    cleanups.push(() => server.stop())
    const pair = (name: string) => {
      const offer = server.createPairingOffer({ address: '127.0.0.1', name, scope: 'mobile' })
      if (!offer.available) {
        throw new Error('pairing unavailable')
      }
      return offer.pairingUrl
    }
    const metadata = readRuntimeMetadata(userDataPath)!
    const created = await sendRequest(metadata.transports[0]!.endpoint, {
      id: 'create',
      authToken: metadata.authToken,
      method: 'terminal.create',
      params: {
        worktree: WORKTREE,
        command: 'shell',
        tabId: 'tab-1',
        leafId: '11111111-1111-4111-8111-111111111111',
        cols: SPAWN.cols,
        rows: SPAWN.rows
      }
    })
    const handle = z.object({ terminal: z.object({ handle: z.string() }) }).parse(created.result)
      .terminal.handle
    const joinPhone = async (url: string) => {
      const attached = await attach(url, handle)
      cleanups.push(() => attached.close())
      return attached
    }
    const wiring = (
      server as unknown as {
        mobileSocketWiring: {
          terminateDeviceConnections: (deviceId: string) => number
          handleRawMessage: (...args: unknown[]) => void
        }
      }
    ).mobileSocketWiring
    const removeRowOnDisk = (deviceId: string): void => {
      const registryFile = join(userDataPath, DEVICE_REGISTRY_FILENAME)
      const rows = JSON.parse(readFileSync(registryFile, 'utf8')) as { deviceId: string }[]
      expect(rows.some((row) => row.deviceId === deviceId)).toBe(true)
      writeFileSync(registryFile, JSON.stringify(rows.filter((row) => row.deviceId !== deviceId)))
    }
    /** Whether the host accepts a brand-new connection with the given pairing. */
    const freshSignIn = async (url: string): Promise<boolean> => {
      try {
        const subscription = await subscribeRemoteRuntimeTransport(
          pairedRuntimeConnectionFromOffer(parsePairingCode(url)!),
          'status.get',
          {},
          10_000,
          { onResponse: () => {}, onError: () => {} }
        )
        subscription.close()
        return true
      } catch {
        return false
      }
    }
    const flood = async (tag: string): Promise<void> => {
      for (let i = 0; i < FLOOD_CHUNKS; i++) {
        const marker = `<<${tag}:${i}>>`
        const data = `${marker}${'x'.repeat(FLOOD_CHUNK_BYTES - marker.length - 2)}\r\n`
        runtime.onPtyData(PTY_ID, data, Date.now())
        await sleep(5)
      }
    }
    return { runtime, server, wiring, writes, pair, joinPhone, removeRowOnDisk, freshSignIn, flood }
  }

  it('row removed on disk: a silent socket subscribed without ackOutput keeps streaming', async () => {
    const h = await start()
    const registry = h.server.getDeviceRegistry()!
    const url = h.pair('phone')
    const deviceId = registry.validateToken(parsePairingCode(url)!.deviceToken)!.deviceId
    const phone = await h.joinPhone(url)

    h.runtime.onPtyData(PTY_ID, 'before-revoke\r\n', Date.now())
    await vi.waitFor(() => expect(phone.output()).toContain('before-revoke'), SLOW_WAIT)
    const terminate = vi.spyOn(h.wiring, 'terminateDeviceConnections')

    h.removeRowOnDisk(deviceId)
    await sleep(1_300)

    // The host's own sign-in path is what notices the removal; the test does not touch the registry.
    expect(await h.freshSignIn(url)).toBe(false)
    expect(registry.listDevices().some((d) => d.deviceId === deviceId)).toBe(false)

    // Counts every application frame the host receives on any mobile socket from here on.
    const inbound = vi.spyOn(h.wiring, 'handleRawMessage')
    const bytesBefore = phone.outputBytes()
    await h.flood('POST')
    await vi.waitFor(
      () => expect(phone.output()).toContain(`<<POST:${FLOOD_CHUNKS - 1}>>`),
      SLOW_WAIT
    )
    const delivered = phone.outputBytes() - bytesBefore
    const markers = Array.from({ length: FLOOD_CHUNKS }, (_, i) => i).filter((i) =>
      phone.output().includes(`<<POST:${i}>>`)
    ).length
    expect(markers).toBe(FLOOD_CHUNKS)
    expect(delivered).toBeGreaterThan(2_000_000)
    expect(phone.isClosed()).toBe(false)

    await sleep(HEARTBEAT_SPAN_MS)
    h.runtime.onPtyData(PTY_ID, 'late-marker-after-heartbeats\r\n', Date.now())
    await vi.waitFor(
      () => expect(phone.output()).toContain('late-marker-after-heartbeats'),
      SLOW_WAIT
    )
    expect(phone.isClosed()).toBe(false)
    expect(terminate).not.toHaveBeenCalled()

    expect(inbound.mock.calls.length).toBe(0)

    // Strongest control on the path: the first inbound application frame is refused.
    const writesBefore = h.writes.length
    phone.type('x')
    await vi.waitFor(() => expect(phone.isClosed()).toBe(true), SLOW_WAIT)
    await sleep(300)
    expect(h.writes.length).toBe(writesBefore)
  }, 240_000)

  it('control: the in-process revoke used by the desktop app closes the socket', async () => {
    const h = await start()
    const registry = h.server.getDeviceRegistry()!
    const url = h.pair('phone-baseline')
    const deviceId = registry.validateToken(parsePairingCode(url)!.deviceToken)!.deviceId
    const phone = await h.joinPhone(url)
    h.runtime.onPtyData(PTY_ID, 'before-revoke\r\n', Date.now())
    await vi.waitFor(() => expect(phone.output()).toContain('before-revoke'), SLOW_WAIT)

    const revoked = await h.server.revokeMobileDevice(deviceId)
    await vi.waitFor(() => expect(phone.isClosed()).toBe(true), SLOW_WAIT)
    h.runtime.onPtyData(PTY_ID, 'after-inprocess-revoke\r\n', Date.now())
    await sleep(1_000)
    expect(revoked).toBe(true)
    expect(phone.output()).not.toContain('after-inprocess-revoke')
  }, 120_000)
})
