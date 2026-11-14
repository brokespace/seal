import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeviceRegistry } from './device-registry'
import { DEVICE_REGISTRY_FILENAME } from './mobile-pairing-files'

const START = 1_800_000_000_000
const DAY_MS = 24 * 60 * 60_000
const OFFER_TTL_MS = 10 * 60_000
let dir: string

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(START)
  dir = mkdtempSync(join(tmpdir(), 'orca-credential-lifetime-'))
})

afterEach(() => {
  vi.useRealTimers()
  rmSync(dir, { recursive: true, force: true })
})

function registryFile(): string {
  return readFileSync(join(dir, DEVICE_REGISTRY_FILENAME), 'utf8')
}

function writeRegistryFile(rows: unknown[]): void {
  writeFileSync(join(dir, DEVICE_REGISTRY_FILENAME), JSON.stringify(rows))
}

describe('device tokens at rest', () => {
  it('keeps only a hash on disk once a device has signed in', () => {
    const registry = new DeviceRegistry(dir)
    const offer = registry.addDevice('Phone', 'mobile', 'network', [], OFFER_TTL_MS)
    registry.updateLastSeen(offer.deviceId)

    expect(registryFile()).not.toContain(offer.token)
    expect(new DeviceRegistry(dir).validateToken(offer.token)?.deviceId).toBe(offer.deviceId)
    expect(new DeviceRegistry(dir).validateToken(`${offer.token}x`)).toBeNull()
  })

  it('rewrites rows an older build stored in the clear, and they still sign in', () => {
    const token = 'plaintext-row-from-an-older-build'
    writeRegistryFile([
      { deviceId: 'phone-1', name: 'Phone', token, pairedAt: START - 5_000, lastSeenAt: START - 1 }
    ])

    const registry = new DeviceRegistry(dir)

    expect(registryFile()).not.toContain(token)
    expect(registry.validateToken(token)?.deviceId).toBe('phone-1')
    expect(new DeviceRegistry(dir).validateToken(token)?.deviceId).toBe('phone-1')
  })
})

describe('credential expiry', () => {
  it('refuses an unused offer an older build wrote without an expiry', () => {
    const token = 'unused-offer-without-expiry'
    writeRegistryFile([
      { deviceId: 'offer-1', name: 'Phone', token, pairedAt: START, lastSeenAt: 0 }
    ])

    expect(new DeviceRegistry(dir).validateToken(token)).toBeNull()
  })

  it('refuses a bearer unused for 30 days and hands it out for revocation', () => {
    const registry = new DeviceRegistry(dir)
    const phone = registry.addDevice('Phone', 'mobile', 'network', [], OFFER_TTL_MS)
    registry.updateLastSeen(phone.deviceId)

    vi.setSystemTime(START + 30 * DAY_MS)
    expect(registry.validateToken(phone.token)?.deviceId).toBe(phone.deviceId)
    expect(registry.takeRevokedDevices()).toEqual([])

    vi.setSystemTime(START + 30 * DAY_MS + 1)
    expect(registry.validateToken(phone.token)).toBeNull()
    expect(registry.takeRevokedDevices().map((device) => device.deviceId)).toEqual([phone.deviceId])
    expect(registry.listCurrentDevices()).toEqual([])
  })

  it('keeps a bearer that is used within 30 days', () => {
    const registry = new DeviceRegistry(dir)
    const phone = registry.addDevice('Phone', 'mobile', 'network', [], OFFER_TTL_MS)
    registry.updateLastSeen(phone.deviceId)

    vi.setSystemTime(START + 29 * DAY_MS)
    registry.updateLastSeen(phone.deviceId)
    vi.setSystemTime(START + 58 * DAY_MS)

    expect(registry.validateToken(phone.token)?.deviceId).toBe(phone.deviceId)
  })

  it('never expires a device-key row', () => {
    writeRegistryFile([
      {
        deviceId: 'keyed-1',
        name: 'Phone',
        credentialKind: 'device-key',
        devicePublicKeyB64: Buffer.alloc(32, 7).toString('base64'),
        pairedAt: START,
        lastSeenAt: START
      }
    ])
    const registry = new DeviceRegistry(dir)

    vi.setSystemTime(START + 400 * DAY_MS)

    expect(registry.lookupDeviceKey('keyed-1').kind).toBe('found')
    expect(registry.takeRevokedDevices()).toEqual([])
  })
})

describe('rows removed from the registry file', () => {
  it('are handed out once as revoked devices, with what their cleanup needs', () => {
    const registry = new DeviceRegistry(dir)
    const phone = registry.addDevice('Phone', 'mobile', 'network', [], OFFER_TTL_MS)
    const kept = registry.addDevice('Desktop', 'runtime')
    registry.updateLastSeen(phone.deviceId)
    registry.updateLastSeen(kept.deviceId)
    registry.setRelayBinding(phone.deviceId, {
      relayHostId: 'host-1',
      relayDeviceId: phone.deviceId,
      ownerIdentityKey: 'owner-key'
    })

    const rows: { deviceId: string }[] = JSON.parse(registryFile())
    writeRegistryFile(rows.filter((row) => row.deviceId !== phone.deviceId))
    // The file's mtime may not have moved within one tick; the sweep reads it regardless.
    expect(registry.listCurrentDevices().map((device) => device.deviceId)).toEqual([kept.deviceId])

    const revoked = registry.takeRevokedDevices()
    expect(revoked.map((device) => device.deviceId)).toEqual([phone.deviceId])
    expect(revoked[0]!.relayBinding?.relayHostId).toBe('host-1')
    expect(registry.takeRevokedDevices()).toEqual([])
    expect(registry.validateToken(phone.token)).toBeNull()
  })

  it('does not report a row this process removed itself', () => {
    const registry = new DeviceRegistry(dir)
    const phone = registry.addDevice('Phone', 'mobile', 'network', [], OFFER_TTL_MS)
    registry.updateLastSeen(phone.deviceId)

    registry.removeDevice(phone.deviceId)

    expect(registry.takeRevokedDevices()).toEqual([])
  })
})
