import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import nacl from 'tweetnacl'
import { beforeAll, describe, expect, it } from 'vitest'
import { DeviceRegistry } from '../../../src/main/runtime/rpc/server/pairing/device-registry'
import {
  importReleaseCheckoutModule,
  materializeReleaseCheckout,
  resolveBaselineReleaseRef
} from './release-checkout'

// Across downgrade, preserve keyed and hashed token rows inertly.
const SUITE_TIMEOUT_MS = 180_000

type RegistryLike = {
  validateToken(token: string): { deviceId: string } | null
  updateLastSeen(deviceId: string): void
  listDevices(): readonly Record<string, unknown>[]
}

let ReleasedRegistry: new (userDataPath: string) => RegistryLike

beforeAll(async () => {
  const checkout = await materializeReleaseCheckout(resolveBaselineReleaseRef())
  const registryModule = await importReleaseCheckoutModule(
    checkout,
    'src/main/runtime/rpc/server/pairing/device-registry.ts'
  )
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the pinned release's DeviceRegistry class; a changed shape fails the assertions below.
  ReleasedRegistry = registryModule.DeviceRegistry as typeof ReleasedRegistry
}, SUITE_TIMEOUT_MS)

describe('cross-version: device keys against a released host', () => {
  it('a released registry keeps keyed and hashed token rows intact and inert', () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'orca-xv-device-key-'))
    const current = new DeviceRegistry(userDataPath)
    const legacy = current.addDevice('Phone', 'mobile')
    current.updateLastSeen(legacy.deviceId)
    const keyB64 = Buffer.from(nacl.sign.keyPair().publicKey).toString('base64')
    const forked = current.forkDeviceKey(legacy.deviceId, keyB64, 'Phone (key)')

    const released = new ReleasedRegistry(userDataPath)
    // Only the token's hash is stored, which a released build cannot check: downgrading needs a re-pair.
    expect(released.validateToken(legacy.token)).toBeNull()
    expect(released.validateToken('undefined')).toBeNull()
    released.updateLastSeen(legacy.deviceId)

    const reread = new DeviceRegistry(userDataPath)
    expect(reread.getDevice(forked.deviceId)).toMatchObject({
      credentialKind: 'device-key',
      devicePublicKeyB64: keyB64,
      forkedFrom: legacy.deviceId
    })
    expect(reread.lookupDeviceKey(forked.deviceId)).toMatchObject({ kind: 'found' })
    expect(reread.validateToken(legacy.token)?.deviceId).toBe(legacy.deviceId)
    expect(JSON.parse(readFileSync(join(userDataPath, 'orca-devices.json'), 'utf-8'))).toHaveLength(
      2
    )
  })
})
