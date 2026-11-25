import type {
  PairedDeviceSummary,
  PairedDevicesRevokeParams,
  PairedDevicesRevokeResult
} from '../../../../../shared/paired-device-admin-contract'
import type { DeviceEntry } from './device-entry'

/** Built field by field so no credential (token, hash, key, push or relay secret) can ride along. */
export function summarizePairedDevice(device: DeviceEntry): PairedDeviceSummary {
  const offer = device.credentialKind === undefined && device.lastSeenAt === 0
  return {
    deviceId: device.deviceId,
    name: device.name,
    scope: device.scope,
    credential: device.credentialKind === 'device-key' ? 'device-key' : 'token',
    state: offer ? 'offer' : 'paired',
    pairedAt: device.pairedAt,
    lastSeenAt: device.lastSeenAt,
    ...(offer && device.offerExpiresAt !== undefined
      ? { offerExpiresAt: device.offerExpiresAt }
      : {}),
    route: device.parentDeviceId ? 'via-desktop' : device.relayBinding ? 'relay' : 'direct',
    ...(device.relayBinding ? { relayDeviceId: device.relayBinding.relayDeviceId } : {}),
    ...(device.parentDeviceId ? { parentDeviceId: device.parentDeviceId } : {}),
    ...(device.forkedFrom ? { forkedFrom: device.forkedFrom } : {}),
    ...(device.grants?.length ? { grants: [...device.grants] } : {})
  }
}

/** Resolves an owner's revoke request against the registry and runs `revoke` on the named rows. */
export function revokeNamedPairedDevices(
  devices: readonly DeviceEntry[],
  params: PairedDevicesRevokeParams,
  revoke: (roots: readonly DeviceEntry[]) => readonly DeviceEntry[] | null
): PairedDevicesRevokeResult {
  const wanted = params.all ? devices.map((device) => device.deviceId) : (params.deviceIds ?? [])
  const roots: DeviceEntry[] = []
  const notFound: string[] = []
  for (const deviceId of new Set(wanted)) {
    const device = devices.find((candidate) => candidate.deviceId === deviceId)
    if (device) {
      roots.push(device)
    } else {
      notFound.push(deviceId)
    }
  }
  const revoked = roots.length > 0 ? revoke(roots) : []
  if (!revoked) {
    throw new Error('device_revoke_failed')
  }
  return { revoked: revoked.map(summarizePairedDevice), notFound }
}
