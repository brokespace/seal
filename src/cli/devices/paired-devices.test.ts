import { chmodSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { acquireOrcadInstanceLock } from '../../main/orcad/instance-lock/orcad-instance-lock'
import { RelayRevokeOutbox } from '../../main/runtime/mobile-cloud-relay/pairing/relay-revoke-outbox'
import { PushUnregisterOutbox } from '../../main/runtime/push/push-unregister-outbox'
import { DeviceRegistry } from '../../main/runtime/rpc/server/pairing/device-registry'
import { RuntimeClientError } from '../runtime/connection/types'
import { PAIRED_DEVICES_HANDLERS } from './paired-devices'

let dir: string
let printed: string[]

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orca-devices-cli-'))
  chmodSync(dir, 0o700)
  vi.stubEnv('ORCA_USER_DATA_PATH', dir)
  printed = []
  vi.spyOn(console, 'log').mockImplementation((line: string) => void printed.push(line))
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  process.exitCode = undefined
})

/** A phone that signed in once, with the relay credential and push registration a revoke must withdraw. */
function pairedPhone() {
  const registry = new DeviceRegistry(dir)
  const phone = registry.addDevice('Phone', 'mobile', 'network', [], 600_000)
  registry.updateLastSeen(phone.deviceId)
  registry.setRelayBinding(phone.deviceId, {
    relayHostId: 'AbCdEf0123_-xyZ9',
    relayDeviceId: phone.deviceId,
    ownerIdentityKey: 'owner-key'
  })
  registry.setPushRegistration(phone.deviceId, {
    registrationId: 'registration-1',
    filter: {},
    expiresAt: 1_900_000_000_000
  })
  return phone
}

function run(
  command: 'devices list' | 'devices revoke',
  flags: [string, string | boolean][],
  call: (method: string, params: unknown) => Promise<unknown>
): Promise<void> {
  return PAIRED_DEVICES_HANDLERS[command]!({
    flags: new Map(flags),
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handlers use only isRemote and call.
    client: { isRemote: false, call } as never,
    cwd: dir,
    json: true
  })
}

const notRunning = async (): Promise<never> => {
  throw new RuntimeClientError('runtime_unavailable', 'no runtime')
}

describe('orca devices', () => {
  it('revokes through the running Orca and leaves the files to it', async () => {
    const phone = pairedPhone()
    const call = vi.fn(async () => ({ result: { revoked: [], notFound: [] } }))

    await run('devices revoke', [['device', phone.deviceId]], call)

    expect(call.mock.calls).toEqual([['pairing.revokeDevices', { deviceIds: [phone.deviceId] }]])
    expect(new DeviceRegistry(dir).getDevice(phone.deviceId)).not.toBeNull()
  })

  it('with no Orca running, removes the device on disk and queues its relay and push withdrawals', async () => {
    const phone = pairedPhone()
    const kept = new DeviceRegistry(dir).addDevice('Desktop', 'runtime')

    await run('devices revoke', [['device', phone.deviceId]], notRunning)

    expect(JSON.parse(printed[0]!)).toMatchObject({
      ok: true,
      result: { revoked: [{ deviceId: phone.deviceId }], notFound: [], source: 'offline' }
    })
    const registry = new DeviceRegistry(dir)
    expect(registry.listDevices().map((device) => device.deviceId)).toEqual([kept.deviceId])
    expect(registry.validateToken(phone.token)).toBeNull()
    expect(
      new RelayRevokeOutbox(dir)
        .pendingFor('owner-key', 'AbCdEf0123_-xyZ9')
        .map((item) => item.relayDeviceId)
    ).toEqual([phone.deviceId])
    expect(new PushUnregisterOutbox(dir).pending().map((item) => item.registrationId)).toEqual([
      'registration-1'
    ])
  })

  it('revokes every device with --all', async () => {
    pairedPhone()
    new DeviceRegistry(dir).addDevice('Desktop', 'runtime')

    await run('devices revoke', [['all', true]], notRunning)

    expect(new DeviceRegistry(dir).listDevices()).toEqual([])
  })

  it('changes nothing while an Orca that does not answer holds the profile', async () => {
    const phone = pairedPhone()
    const lock = acquireOrcadInstanceLock(dir)
    try {
      await expect(
        run('devices revoke', [['device', phone.deviceId]], notRunning)
      ).rejects.toMatchObject({ code: 'runtime_unavailable' })
    } finally {
      lock.release()
    }
    expect(new DeviceRegistry(dir).getDevice(phone.deviceId)).not.toBeNull()
  })

  it('lists devices without their credentials', async () => {
    const phone = pairedPhone()
    // An unused offer is the one row whose bearer is still readable in the file.
    const offer = new DeviceRegistry(dir).addDevice('Offer', 'runtime', 'network', [], 600_000)

    await run('devices list', [], notRunning)

    expect(JSON.parse(printed[0]!).result.devices).toMatchObject([
      { deviceId: phone.deviceId, name: 'Phone', scope: 'mobile', state: 'paired', route: 'relay' },
      { deviceId: offer.deviceId, name: 'Offer', scope: 'runtime', state: 'offer', route: 'direct' }
    ])
    expect(printed[0]).not.toContain(offer.token)
    expect(printed[0]).not.toContain('owner-key')
    expect(printed[0]).not.toContain('registration-1')
  })
})
