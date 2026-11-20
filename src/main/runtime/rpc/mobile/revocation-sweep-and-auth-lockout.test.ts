import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import nacl from 'tweetnacl'
import type { WebSocket } from 'ws'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateKeyPair } from '../../../../shared/remote-runtime/e2ee/node/e2ee-crypto'
import { SimulatedMobileE2EEV2Peer } from '../../mobile-cloud-relay/testing/simulated-mobile-e2ee-v2-peer'
import type { DeviceEntry } from '../server/pairing/device-entry'
import { DeviceRegistry } from '../server/pairing/device-registry'
import { DEVICE_REGISTRY_FILENAME } from '../server/pairing/mobile-pairing-files'
import {
  MobileSocketWiring,
  type MobileSocketTransport,
  type MobileSocketTransportMetadata
} from './mobile-socket-wiring'

const START = 1_800_000_000_000

class FakeSocket {
  readonly OPEN = 1
  readyState = this.OPEN
  bufferedAmount = 0
  readonly sent: (string | Buffer)[] = []
  readonly send = vi.fn((data: string | Buffer) => this.sent.push(data))
  readonly close = vi.fn()
  readonly terminate = vi.fn()
}

class FakeTransport implements MobileSocketTransport {
  private messageHandler: Parameters<MobileSocketTransport['onMessage']>[0] | null = null
  readonly metadata = new Map<FakeSocket, MobileSocketTransportMetadata>()
  readonly setClientId = vi.fn()
  readonly terminateClientConnections = vi.fn(() => 0)
  onMessage(handler: Parameters<MobileSocketTransport['onMessage']>[0]): void {
    this.messageHandler = handler
  }
  onConnectionClose(): void {}
  receive(ws: FakeSocket, message: string): void {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the wiring only sends, closes, terminates and reads OPEN/readyState/bufferedAmount.
    this.messageHandler?.(message, vi.fn(), ws as unknown as WebSocket)
  }
}

const host = generateKeyPair()
let dir: string
let wiring: MobileSocketWiring

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(START)
  dir = mkdtempSync(join(tmpdir(), 'orca-revocation-sweep-'))
})

afterEach(() => {
  wiring.dispose()
  vi.useRealTimers()
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

function harness(registry: DeviceRegistry) {
  const transport = new FakeTransport()
  const revoked: DeviceEntry[][] = []
  wiring = new MobileSocketWiring({
    deviceRegistry: registry,
    e2eeKeypair: {
      publicKey: host.publicKey,
      secretKey: host.secretKey,
      publicKeyB64: Buffer.from(host.publicKey).toString('base64')
    },
    onText: vi.fn(),
    onBinary: vi.fn(),
    onClose: vi.fn(),
    onDevicesRevoked: (devices) => revoked.push(devices)
  })
  wiring.attachTransport(
    transport,
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the transport only ever hands back the FakeSocket it was given.
    (ws) => transport.metadata.get(ws as unknown as FakeSocket) ?? { transport: 'direct' }
  )

  /** Opens a socket from `metadata` and signs in with `deviceToken`; returns the socket and verdict. */
  function signIn(deviceToken: string, metadata: MobileSocketTransportMetadata) {
    const ws = new FakeSocket()
    transport.metadata.set(ws, metadata)
    const peer = new SimulatedMobileE2EEV2Peer(
      nacl.box.keyPair(),
      host.publicKey,
      metadata.transport === 'relay' ? metadata.relayHostId : null
    )
    transport.receive(ws, JSON.stringify(peer.hello))
    if (ws.sent.length === 0) {
      return { ws, authenticated: false }
    }
    peer.acceptReady(JSON.parse(String(ws.sent[0])))
    transport.receive(
      ws,
      peer.sealText(
        JSON.stringify({
          type: 'e2ee_auth',
          v: 2,
          transcriptHashB64: peer.transcriptHashB64,
          deviceToken
        })
      )
    )
    const reply = ws.sent[1] ? JSON.parse(peer.openText(String(ws.sent[1]))!) : null
    return { ws, authenticated: reply?.type === 'e2ee_authenticated' }
  }
  return { signIn, revoked }
}

function direct(sourceKey: string): MobileSocketTransportMetadata {
  return { transport: 'direct', sourceKey }
}

function pairedPhone(registry: DeviceRegistry, name = 'Phone') {
  const phone = registry.addDevice(name, 'mobile', 'network', [], 10 * 60_000)
  registry.updateLastSeen(phone.deviceId)
  return phone
}

describe('revocation sweep', () => {
  it('closes a silent socket whose device was removed from the registry file, and reports the device', () => {
    const registry = new DeviceRegistry(dir)
    const phone = pairedPhone(registry)
    const other = pairedPhone(registry, 'Tablet')
    const { signIn, revoked } = harness(registry)
    const revokedSocket = signIn(phone.token, direct('203.0.113.5'))
    const keptSocket = signIn(other.token, direct('203.0.113.6'))
    expect(revokedSocket.authenticated).toBe(true)

    wiring.sweepRevokedDevices(START)
    expect(revokedSocket.ws.close).not.toHaveBeenCalled()

    const path = join(dir, DEVICE_REGISTRY_FILENAME)
    const rows: { deviceId: string }[] = JSON.parse(readFileSync(path, 'utf8'))
    writeFileSync(path, JSON.stringify(rows.filter((row) => row.deviceId !== phone.deviceId)))
    wiring.sweepRevokedDevices(START + 1_000)

    expect(revokedSocket.ws.close).toHaveBeenCalledWith(4001, 'Unauthorized')
    expect(revokedSocket.ws.terminate).toHaveBeenCalledTimes(1)
    expect(keptSocket.ws.close).not.toHaveBeenCalled()
    expect(revoked.map((devices) => devices.map((device) => device.deviceId))).toEqual([
      [phone.deviceId]
    ])
  })
})

describe('failed sign-in lockout', () => {
  it('refuses a source after three failed sign-ins without looking up a credential, and no other source', () => {
    const registry = new DeviceRegistry(dir)
    const phone = pairedPhone(registry)
    const { signIn } = harness(registry)
    const attacker = direct('198.51.100.9')

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const failed = signIn('not-a-paired-token', attacker)
      expect(failed.ws.close).toHaveBeenCalledWith(4001, 'Unauthorized')
    }
    const validateToken = vi.spyOn(registry, 'validateToken')
    // Even the right credential is refused while the source is locked out.
    const locked = signIn(phone.token, attacker)

    expect(locked.authenticated).toBe(false)
    expect(locked.ws.close).toHaveBeenCalledWith(1013, 'Too many failed sign-ins')
    expect(locked.ws.sent).toEqual([])
    expect(validateToken).not.toHaveBeenCalled()
    expect(signIn(phone.token, direct('198.51.100.10')).authenticated).toBe(true)
  })

  it('lets the source back in after one second, doubles the wait on the next failure, and forgets on success', () => {
    const registry = new DeviceRegistry(dir)
    const phone = pairedPhone(registry)
    const { signIn } = harness(registry)
    const source = direct('127.0.0.1')
    for (let attempt = 0; attempt < 3; attempt += 1) {
      signIn('not-a-paired-token', source)
    }

    vi.setSystemTime(START + 999)
    expect(signIn(phone.token, source).authenticated).toBe(false)
    vi.setSystemTime(START + 1_000)
    signIn('not-a-paired-token', source)
    vi.setSystemTime(START + 2_999)
    expect(signIn(phone.token, source).authenticated).toBe(false)
    vi.setSystemTime(START + 3_000)
    expect(signIn(phone.token, source).authenticated).toBe(true)

    // The count restarted: two more failures do not lock the source.
    signIn('not-a-paired-token', source)
    signIn('not-a-paired-token', source)
    expect(signIn(phone.token, source).authenticated).toBe(true)
  })

  it('counts relay failures per relay device, not per relay', () => {
    const registry = new DeviceRegistry(dir)
    const phone = pairedPhone(registry)
    const { signIn } = harness(registry)
    const relayed = (relayDeviceId: string): MobileSocketTransportMetadata => ({
      transport: 'relay',
      relayHostId: 'AbCdEf0123_-xyZ9',
      relayDeviceId,
      basisConnId: 'conn-1',
      credentialKind: 'resume'
    })
    for (let attempt = 0; attempt < 3; attempt += 1) {
      signIn('not-a-paired-token', relayed('someone-else'))
    }

    expect(signIn(phone.token, relayed('someone-else')).ws.close).toHaveBeenCalledWith(
      1013,
      'Too many failed sign-ins'
    )
    expect(signIn(phone.token, relayed(phone.deviceId)).authenticated).toBe(true)
  })
})
