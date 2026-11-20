// Audit 1, A1-05, fixed: removing a phone's row from orca-devices.json left its push delivery,
// relay credential and push registration live. These assert that the removal is now finished as a
// revoke, with no client activity: pushes stop at once, and within the revocation sweep the relay
// refuses the phone's credential and the Worker drops its push registration.
// Real DeviceRegistry, DesktopPushService, relay control client, data transport, socket wiring and
// revoke path against the real Worker in local workerd with fake APNs. Keys and tokens are generated here.
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { RelayControlClient } from '../../../../../src/main/runtime/mobile-cloud-relay/control-channel/relay-control-client'
import {
  createSealRelayContextReader,
  sealRelayEndpointConfig,
  sealRelayIdentity
} from '../../../../../src/main/runtime/mobile-cloud-relay/authentication/seal-relay-host-auth'
import { relayIdentityKey } from '../../../../../src/main/runtime/mobile-cloud-relay/authentication/relay-auth-identity'
import {
  deriveRelayHostId,
  exchangeRelayAuthorization,
  requestRelayAssignment
} from '../../../../../src/main/runtime/mobile-cloud-relay/director/relay-http-client'
import { RelayAssignRateGate } from '../../../../../src/main/runtime/mobile-cloud-relay/director/relay-assign-rate-gate'
import { RelayRevokeDelivery } from '../../../../../src/main/runtime/mobile-cloud-relay/pairing/relay-revoke-delivery'
import { RelayRevokeOutbox } from '../../../../../src/main/runtime/mobile-cloud-relay/pairing/relay-revoke-outbox'
import { MobileSocketWiring } from '../../../../../src/main/runtime/rpc/mobile/mobile-socket-wiring'
import { DeviceRegistry } from '../../../../../src/main/runtime/rpc/server/pairing/device-registry'
import { revokeDevices } from '../../../../../src/main/runtime/rpc/server/pairing/device-revocation'
import { CloudRelayTransport } from '../../../../../src/main/runtime/rpc/transports/relay-transport'
import { DesktopPushService } from '../../../../../src/main/runtime/push/desktop-push-service'
import { PushUnregisterOutbox } from '../../../../../src/main/runtime/push/push-unregister-outbox'
import {
  generateTestSecrets,
  newHostKeypair,
  sleep,
  startFakeProviders,
  startSealRelay,
  waitFor
} from '../../seal-relay-harness'

const WAIT_MS = 20_000

let relay: Awaited<ReturnType<typeof startSealRelay>>
let providers: Awaited<ReturnType<typeof startFakeProviders>>
let userData: string
const hostKeys = newHostKeypair()

type RelayHello = { ok?: boolean; credentialKind?: string }

async function relayHelloFor(relayHostId: string, credential: string): Promise<RelayHello | null> {
  const socket = new WebSocket(`${relay.origin.replace(/^http/, 'ws')}/v1/connect/${relayHostId}`, {
    perMessageDeflate: false
  })
  let hello: RelayHello | null = null
  let closed = false
  socket.on('open', () =>
    socket.send(JSON.stringify({ type: 'relay-auth', v: 1, mode: 'connect', credential }))
  )
  socket.on('message', (raw: Buffer, isBinary: boolean) => {
    if (!isBinary) {
      hello ??= JSON.parse(raw.toString()) as RelayHello
    }
  })
  socket.on('close', () => {
    closed = true
  })
  socket.on('error', () => {})
  await waitFor(() => hello !== null || closed, WAIT_MS)
  socket.close()
  return hello
}

function alertBodiesFor(token: string): string[] {
  return providers.requests
    .filter((request) => request.path.endsWith(`/3/device/${token}`))
    .map(
      (request) => (JSON.parse(request.body) as { aps: { alert: { body: string } } }).aps.alert.body
    )
}

describe('audit 1 A1-05: phone row removed from orca-devices.json', () => {
  beforeAll(async () => {
    userData = mkdtempSync(join(tmpdir(), 'seal-audit-1-registry-'))
    providers = await startFakeProviders()
    const generated = await generateTestSecrets()
    relay = await startSealRelay(generated.secrets, {
      enrolled: [hostKeys],
      providerOrigin: providers.origin
    })
  })

  afterAll(async () => {
    await relay?.dispose()
    await providers?.close()
    rmSync(userData, { recursive: true, force: true })
  })

  it('stops push delivery and withdraws the relay credential and the push registration', async () => {
    const registryPath = join(userData, 'orca-devices.json')
    const relayHostId = deriveRelayHostId(hostKeys.publicKey)
    const ownerIdentityKey = relayIdentityKey(sealRelayIdentity(relayHostId))

    const registry = new DeviceRegistry(userData)
    const removed = registry.addDevice('Phone A', 'mobile')
    registry.updateLastSeen(removed.deviceId)
    const kept = registry.addDevice('Phone B', 'mobile')
    registry.updateLastSeen(kept.deviceId)

    const context = await createSealRelayContextReader({
      relayOrigin: relay.origin,
      keypair: hostKeys
    })()
    const endpoints = sealRelayEndpointConfig(relay.origin)
    const { relayToken } = await exchangeRelayAuthorization({
      endpoint: endpoints.relayTokenEndpoint,
      accessToken: context!.accessToken,
      keypair: hostKeys
    })
    const assignment = await requestRelayAssignment({
      directorUrl: endpoints.relayDirectorUrl,
      relayToken,
      relayHostId,
      assignRateGate: new RelayAssignRateGate()
    })
    const opens: { relayDeviceId: string }[] = []
    let transport: CloudRelayTransport | null = null
    const client = new RelayControlClient({
      cellUrl: assignment.cellUrl,
      relayJwt: relayToken,
      relayHostId,
      assignmentEpoch: assignment.assignmentEpoch,
      identity: sealRelayIdentity(relayHostId),
      keypair: hostKeys,
      appVersion: 'seal-test',
      onConnectionOpen: (open) => {
        opens.push(open)
        void transport?.openConnection(open).catch(() => {})
      },
      onDrain: () => {},
      onClose: () => {},
      createSocket: (url, token) =>
        new WebSocket(url, {
          headers: { authorization: `Bearer ${token}` },
          perMessageDeflate: false
        })
    })
    const ack = await client.connect()
    transport = new CloudRelayTransport({
      cellUrl: assignment.cellUrl,
      relayHostId,
      generation: ack.generation
    })
    const liveTransport = transport
    const relayOutbox = new RelayRevokeOutbox(userData)
    const pushOutbox = new PushUnregisterOutbox(userData)
    const revokeDelivery = new RelayRevokeDelivery({
      outbox: relayOutbox,
      activeSender: () => ({
        hostId: relayHostId,
        ownerIdentityKey,
        revokeDevice: (relayDeviceId, reqId) => client.revokeDevice(relayDeviceId, reqId)
      }),
      onDelivered: () => {}
    })
    const queued = { relay: 0, push: 0 }
    const wiring: MobileSocketWiring = new MobileSocketWiring({
      deviceRegistry: registry,
      e2eeKeypair: hostKeys,
      onText: () => {},
      onBinary: () => {},
      onClose: () => {},
      // As the RPC server wires it: a row that left the file is finished by the one revoke path.
      onDevicesRevoked: (devices) => {
        revokeDevices(devices, {
          registry,
          queueRelayDeviceRevoke: (binding) => {
            relayOutbox.enqueue(binding)
            queued.relay += 1
            revokeDelivery.flush()
            return true
          },
          queuePushUnregister: (deviceId, registrationId) => {
            if (registrationId) {
              pushOutbox.enqueue({ registrationId, deviceId })
              queued.push += 1
              void pushService.flushUnregisterOutbox()
            }
          },
          onRevoked: (device) => wiring.terminateDeviceConnections(device.deviceId)
        })
      }
    })
    wiring.attachTransport(liveTransport, (ws) => liveTransport.metadataFor(ws))

    const installResume = async (deviceId: string): Promise<string> => {
      const token = randomBytes(32).toString('base64url')
      await client.installCredential({
        reqId: randomUUID(),
        relayDeviceId: deviceId,
        newResumeTokenHash: createHash('sha256').update(token).digest('base64url'),
        authorization: { mode: 'authenticated-direct', directAuthId: randomUUID() }
      })
      expect(
        registry.setRelayBinding(deviceId, {
          relayHostId,
          relayDeviceId: deviceId,
          ownerIdentityKey
        })
      ).toBe(true)
      return token
    }
    const removedResume = await installResume(removed.deviceId)
    const keptResume = await installResume(kept.deviceId)

    const listeners = new Set<(event: unknown) => void>()
    let seq = 0
    const emit = (body: string): void => {
      seq += 1
      for (const listener of listeners) {
        listener({
          type: 'notification',
          source: 'agent-task-complete',
          agentState: 'done',
          title: 'dummy-repo / main - agent finished',
          body,
          worktreeId: `wt-${seq}`,
          notificationSeq: seq,
          notificationEpoch: 'audit-1-epoch',
          emittedAt: Date.now()
        })
      }
    }
    const pushService = DesktopPushService.create({
      runtime: {
        setMobilePushRegistrar: () => {},
        onNotificationDispatched: (listener: (event: unknown) => void) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        }
      } as never,
      runtimeRpc: {
        getE2EEKeypair: () => hostKeys,
        getDeviceRegistry: () => registry,
        getPushUnregisterOutbox: () => pushOutbox,
        setOnPushUnregisterQueued: () => {}
      } as never,
      gatewayUrl: relay.origin
    })!
    pushService.start()
    const removedApns = randomBytes(32).toString('hex')
    const keptApns = randomBytes(32).toString('hex')
    for (const [deviceId, token] of [
      [removed.deviceId, removedApns],
      [kept.deviceId, keptApns]
    ]) {
      expect(
        await pushService.register({
          deviceId,
          platform: 'ios',
          token,
          apnsEnvironment: 'sandbox',
          filter: {}
        })
      ).toMatchObject({ registered: true })
    }

    emit('BASELINE')
    expect(await waitFor(() => alertBodiesFor(removedApns).length === 1, WAIT_MS)).toBe(true)
    expect(await relayHelloFor(relayHostId, removedResume)).toMatchObject({
      ok: true,
      credentialKind: 'resume'
    })

    // The admin revoke under test: rewrite the file without phone A's row.
    const rows = JSON.parse(readFileSync(registryPath, 'utf-8')) as { deviceId: string }[]
    expect(rows.map((row) => row.deviceId)).toContain(removed.deviceId)
    writeFileSync(
      registryPath,
      JSON.stringify(
        rows.filter((row) => row.deviceId !== removed.deviceId),
        null,
        2
      )
    )

    // No sweep has run and no client has done anything: the very next notification skips phone A.
    emit('AFTER-REMOVAL')
    expect(await waitFor(() => alertBodiesFor(keptApns).includes('AFTER-REMOVAL'), WAIT_MS)).toBe(
      true
    )
    await sleep(500)
    expect(alertBodiesFor(removedApns)).not.toContain('AFTER-REMOVAL')

    // The revocation sweep, still with no client activity, queues and delivers both withdrawals.
    expect(
      await waitFor(
        () =>
          queued.relay === 1 &&
          queued.push === 1 &&
          relayOutbox.pendingFor(ownerIdentityKey, relayHostId).length === 0 &&
          pushOutbox.pending().length === 0,
        WAIT_MS
      )
    ).toBe(true)

    // The Worker refuses phone A's resume token and no longer has the host open a data socket.
    const opensBefore = opens.length
    expect((await relayHelloFor(relayHostId, removedResume))?.ok).not.toBe(true)
    expect(opens.length).toBe(opensBefore)

    // The Worker no longer stores a live push registration for phone A.
    const listed = (await (
      await fetch(`${relay.origin}/v1/devices`, {
        headers: { authorization: `Bearer ${context!.accessToken}` }
      })
    ).json()) as { devices: { deviceId: string; dead: boolean }[] }
    expect(
      listed.devices.filter((device) => !device.dead).map((device) => device.deviceId)
    ).toEqual([kept.deviceId])

    // Control: phone B, whose row stayed, keeps its relay credential and its pushes.
    expect(await relayHelloFor(relayHostId, keptResume)).toMatchObject({
      ok: true,
      credentialKind: 'resume'
    })
    expect(registry.validateToken(kept.token)?.deviceId).toBe(kept.deviceId)
    expect(registry.validateToken(removed.token)).toBeNull()

    revokeDelivery.stop()
    pushService.stop()
    wiring.dispose()
    client.closeNow()
    await liveTransport.stop()
  }, 180_000)
})
