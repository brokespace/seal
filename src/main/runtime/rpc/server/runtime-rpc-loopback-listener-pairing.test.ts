import type * as WorktreeScanCacheModule from '../../../git/worktrees/catalog/worktree-scan-cache'
import type * as WorktreeListingModule from '../../../git/worktrees/catalog/worktree-listing'
import '../dispatch/testing/unused-default-rpc-methods.test-fixture'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { deriveRelayHostIdFromPublicKeyB64 } from '../../../../shared/remote-runtime/relay/relay-host-id'
import { buildServePairingReadiness } from '../../../server/serve-pairing-readiness'
import { OrcaRuntimeService } from '../../orca-runtime'
import {
  requestMobilePairingOffer,
  requestRuntimePairingOffer
} from './pairing/pairing-offer-requests'
import { OrcaRuntimeRpcServer } from './runtime-rpc'

vi.mock('../../../git/worktrees/catalog/worktree-scan-cache', async (importOriginal) => {
  const listings = getWorktreeListingMocks()
  return {
    ...(await importOriginal<typeof WorktreeScanCacheModule>()),
    listWorktrees: listings.listWorktrees
  }
})

vi.mock('../../../git/worktrees/catalog/worktree-listing', async (importOriginal) => {
  const listings = getWorktreeListingMocks()
  return {
    ...(await importOriginal<typeof WorktreeListingModule>()),
    listWorktreesStrict: listings.listWorktreesStrict
  }
})

const { getWorktreeListingMocks } = vi.hoisted(() => {
  const createWorktreeListingMocks = () => ({
    listWorktrees: vi.fn().mockResolvedValue([]),
    listWorktreesStrict: vi.fn().mockResolvedValue([])
  })
  let listings: ReturnType<typeof createWorktreeListingMocks> | undefined
  return { getWorktreeListingMocks: () => (listings ??= createWorktreeListingMocks()) }
})

const LOOPBACK_ENDPOINT = /^ws:\/\/127\.0\.0\.1:\d+$/
let server: OrcaRuntimeRpcServer

afterEach(async () => {
  await server.stop()
})

/** `pinnedBindHost` is what `serve` passes; absent is the desktop app. */
async function startServer(pinnedBindHost?: string): Promise<void> {
  server = new OrcaRuntimeRpcServer({
    methods: [],
    runtime: new OrcaRuntimeService(),
    userDataPath: mkdtempSync(join(tmpdir(), 'orca-loopback-pairing-')),
    enableWebSocket: true,
    wsPort: 0,
    ...(pinnedBindHost ? { pinnedBindHost } : {})
  })
  await server.start()
}

function withRelay(): void {
  server.setMobileRelayPairingProvider({
    createPairingRelay: async (relayDeviceId: string) => ({
      relay: {
        v: 1 as const,
        directorUrl: 'https://relay.example.com',
        cellUrl: 'https://cell.example.com',
        assignmentEpoch: 7,
        relayHostId: deriveRelayHostIdFromPublicKeyB64(server.getE2EEPublicKey() ?? '') ?? '',
        inviteToken: 'A'.repeat(43),
        // ast-grep-ignore: test-no-wall-clock -- the real server checks the invite against its own clock
        inviteExpiresAt: Date.now() + 60_000,
        e2eeFraming: 2 as const
      },
      binding: {
        relayHostId: 'AbCdEf0123_-xyZ9',
        relayDeviceId,
        ownerIdentityKey: 'user\0profile\0org'
      }
    }),
    onDeviceRevokeQueued: vi.fn(),
    getEndpoints: vi.fn(),
    provisionRelay: vi.fn()
  })
}

describe('pairing on a listener bound to this machine', () => {
  it('offers another Seal the loopback endpoint and never widens a serve listener', async () => {
    await startServer('127.0.0.1')

    const offer = await requestRuntimePairingOffer(server, {})

    expect(offer).toMatchObject({ available: true })
    expect(server.getWebSocketEndpoint()).toMatch(LOOPBACK_ENDPOINT)
    expect(server.isNetworkExposed()).toBe(false)
  })

  it('refuses a LAN phone pairing on a serve listener bound to loopback', async () => {
    await startServer('127.0.0.1')

    const offer = await requestMobilePairingOffer(server, { connectionMode: 'local-only' })

    expect(offer).toMatchObject({ available: false, reason: 'network_exposure_failed' })
    expect(server.getDeviceRegistry()?.listDevices()).toEqual([])
    expect(server.isNetworkExposed()).toBe(false)
  })

  it('pairs a phone through Relay for `serve --mobile-pairing` without leaving loopback', async () => {
    await startServer('127.0.0.1')
    withRelay()

    const readiness = await buildServePairingReadiness({ mobilePairing: true }, server)

    expect(readiness.pairing).toMatchObject({ available: true, scope: 'mobile' })
    expect(readiness.boundEndpoint).toMatch(LOOPBACK_ENDPOINT)
    expect(server.isNetworkExposed()).toBe(false)
  })

  it('keeps the desktop app on loopback when it pairs a phone through Relay', async () => {
    await startServer()
    withRelay()

    const offer = await requestMobilePairingOffer(server, { connectionMode: 'automatic' })

    expect(offer).toMatchObject({ available: true })
    expect(server.getWebSocketEndpoint()).toMatch(LOOPBACK_ENDPOINT)
    expect(server.isNetworkExposed()).toBe(false)
    // The next launch must not widen for this phone either.
    expect(server.getDeviceRegistry()?.listDevices()[0]?.pairingReach).toBe('this-computer')
  })
})
