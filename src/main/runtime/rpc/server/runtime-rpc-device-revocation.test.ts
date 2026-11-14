import type * as WorktreeScanCacheModule from '../../../git/worktrees/catalog/worktree-scan-cache'
import type * as WorktreeListingModule from '../../../git/worktrees/catalog/worktree-listing'
import '../dispatch/testing/unused-default-rpc-methods.test-fixture'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parsePairingCode } from '../../../../shared/remote-runtime/pairing/pairing'
import { OrcaRuntimeService } from '../../orca-runtime'
import { PAIRING_METHODS } from '../methods/pairing/pairing'
import { DEVICE_REGISTRY_FILENAME } from './pairing/mobile-pairing-files'
import type { DeviceRegistry } from './pairing/device-registry'
import { readRuntimeMetadata } from './runtime-metadata'
import { OrcaRuntimeRpcServer } from './runtime-rpc'
import {
  authenticateMobileWsSession,
  createEncryptedWsResponseReader,
  sendEncryptedWsRequest,
  waitForWsClose,
  type AuthenticatedMobileWs
} from './runtime-rpc-mobile-ws-test-harness'
import { sendRequest } from './runtime-rpc-test-harness'

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

const RELAY_HOST_ID = 'AbCdEf0123_-xyZ9'
let userDataPath: string
let server: OrcaRuntimeRpcServer
let registry: DeviceRegistry
const sessions: AuthenticatedMobileWs[] = []

beforeEach(async () => {
  userDataPath = mkdtempSync(join(tmpdir(), 'orca-device-revocation-'))
  server = new OrcaRuntimeRpcServer({
    runtime: new OrcaRuntimeService(),
    methods: PAIRING_METHODS,
    userDataPath,
    enableWebSocket: true,
    wsPort: 0
  })
  await server.start()
  registry = server.getDeviceRegistry()!
})

afterEach(async () => {
  for (const session of sessions.splice(0)) {
    session.ws.close()
  }
  await server.stop()
})

/** A signed-in phone with a relay credential and a push registration, as after a relay pairing. */
async function pairPhone() {
  const offer = server.createPairingOffer({ address: '127.0.0.1', name: 'Phone', scope: 'mobile' })
  if (!offer.available) {
    throw new Error('WebSocket pairing unavailable')
  }
  const session = await authenticateMobileWsSession(offer.pairingUrl)
  sessions.push(session)
  registry.setRelayBinding(offer.deviceId, {
    relayHostId: RELAY_HOST_ID,
    relayDeviceId: offer.deviceId,
    ownerIdentityKey: 'owner-key'
  })
  registry.setPushRegistration(offer.deviceId, {
    registrationId: `registration-${offer.deviceId}`,
    filter: {},
    expiresAt: 4_102_444_800_000
  })
  return {
    deviceId: offer.deviceId,
    session,
    token: parsePairingCode(offer.pairingUrl)!.deviceToken
  }
}

function ownerCall(method: string, params: unknown): Promise<Record<string, unknown>> {
  const metadata = readRuntimeMetadata(userDataPath)!
  return sendRequest(metadata.transports[0]!.endpoint, {
    id: 'owner',
    authToken: metadata.authToken,
    method,
    params
  })
}

function queuedRelayRevokes(): string[] {
  return server
    .getRelayRevokeOutbox()
    .pendingFor('owner-key', RELAY_HOST_ID)
    .map((item) => item.relayDeviceId)
}

function queuedPushUnregisters(): string[] {
  return server
    .getPushUnregisterOutbox()
    .pending()
    .map((item) => item.registrationId)
}

describe('device revocation', () => {
  it('finishes a row removed from the registry file as a revoke: socket closed, relay and push cleanup queued', async () => {
    const phone = await pairPhone()
    const closed = waitForWsClose(phone.session.ws)

    const path = join(userDataPath, DEVICE_REGISTRY_FILENAME)
    const rows: { deviceId: string }[] = JSON.parse(readFileSync(path, 'utf8'))
    writeFileSync(path, JSON.stringify(rows.filter((row) => row.deviceId !== phone.deviceId)))
    server['mobileSocketWiring']!.sweepRevokedDevices(0)

    await closed
    expect(queuedRelayRevokes()).toEqual([phone.deviceId])
    expect(queuedPushUnregisters()).toEqual([`registration-${phone.deviceId}`])
    expect(registry.validateToken(phone.token)).toBeNull()
  })

  it('revokes through the owner RPC, and the reply names the device without its credential', async () => {
    const phone = await pairPhone()
    const closed = waitForWsClose(phone.session.ws)

    const listed = await ownerCall('pairing.listDevices', {})
    const response = await ownerCall('pairing.revokeDevices', {
      deviceIds: [phone.deviceId, 'nope']
    })

    expect(listed).toMatchObject({
      ok: true,
      result: {
        devices: [
          {
            deviceId: phone.deviceId,
            name: 'Phone',
            scope: 'mobile',
            state: 'paired',
            route: 'relay'
          }
        ]
      }
    })
    expect(response).toMatchObject({
      ok: true,
      result: { revoked: [{ deviceId: phone.deviceId, name: 'Phone' }], notFound: ['nope'] }
    })
    expect(JSON.stringify([listed, response])).not.toContain(phone.token)
    expect(JSON.stringify([listed, response])).not.toContain('owner-key')
    await closed
    expect(registry.getDevice(phone.deviceId)).toBeNull()
    expect(queuedRelayRevokes()).toEqual([phone.deviceId])
    expect(queuedPushUnregisters()).toEqual([`registration-${phone.deviceId}`])
  })

  it('refuses the device admin methods to a phone', async () => {
    const victim = await pairPhone()
    const phone = await pairPhone()
    const reader = createEncryptedWsResponseReader(phone.session)
    try {
      sendEncryptedWsRequest(phone.session, {
        id: 'list',
        method: 'pairing.listDevices',
        params: {}
      })
      sendEncryptedWsRequest(phone.session, {
        id: 'revoke',
        method: 'pairing.revokeDevices',
        params: { deviceIds: [victim.deviceId] }
      })

      expect(await reader.next('list')).toMatchObject({ ok: false })
      expect(await reader.next('revoke')).toMatchObject({ ok: false })
      expect(registry.getDevice(victim.deviceId)).not.toBeNull()
    } finally {
      reader.dispose()
    }
  })

  it('refuses the device admin methods to a paired desktop client', async () => {
    const victim = await pairPhone()
    const offer = server.createPairingOffer({
      address: '127.0.0.1',
      name: 'Desktop',
      scope: 'runtime'
    })
    if (!offer.available) {
      throw new Error('WebSocket pairing unavailable')
    }
    const desktop = await authenticateMobileWsSession(offer.pairingUrl)
    sessions.push(desktop)
    const reader = createEncryptedWsResponseReader(desktop)
    try {
      sendEncryptedWsRequest(desktop, {
        id: 'revoke',
        method: 'pairing.revokeDevices',
        params: { all: true }
      })

      expect(await reader.next('revoke')).toMatchObject({ ok: false, error: { code: 'forbidden' } })
      expect(registry.getDevice(victim.deviceId)).not.toBeNull()
    } finally {
      reader.dispose()
    }
  })
})
