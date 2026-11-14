import type {
  PairedDeviceSummary,
  PairedDevicesListResult,
  PairedDevicesRevokeResult
} from '../../shared/paired-device-admin-contract'
import type { PairedDevicesSource } from './paired-devices'

function time(epochMs: number): string {
  return new Date(epochMs).toISOString()
}

function route(device: PairedDeviceSummary): string {
  if (device.route === 'via-desktop') {
    return `through paired desktop ${device.parentDeviceId ?? 'unknown'}`
  }
  return device.route === 'relay' ? `relay (${device.relayDeviceId ?? 'unbound'})` : 'direct'
}

function describe(device: PairedDeviceSummary): string {
  const expires =
    device.offerExpiresAt === undefined ? '' : `, expires ${time(device.offerExpiresAt)}`
  const lines = [
    `${device.deviceId}  ${device.name}`,
    `  scope: ${device.scope}${device.grants?.length ? ` (${device.grants.join(', ')})` : ''}`,
    `  credential: ${device.credential}${device.forkedFrom ? ` registered from ${device.forkedFrom}` : ''}`,
    device.state === 'offer'
      ? `  unused pairing offer, created ${time(device.pairedAt)}${expires}`
      : `  paired: ${time(device.pairedAt)}  last seen: ${time(device.lastSeenAt)}`,
    `  route: ${route(device)}`
  ]
  return lines.join('\n')
}

const OFFLINE_LIST_NOTE =
  'No Orca is running for this profile; this is the device registry on disk.'

export function formatPairedDevices(
  result: PairedDevicesListResult,
  source: PairedDevicesSource
): string {
  const body =
    result.devices.length === 0 ? 'No paired devices.' : result.devices.map(describe).join('\n\n')
  return source === 'offline' ? `${OFFLINE_LIST_NOTE}\n\n${body}` : body
}

export function formatRevokedDevices(
  result: PairedDevicesRevokeResult,
  source: PairedDevicesSource
): string {
  const lines = result.revoked.map(
    (device) => `Revoked ${device.deviceId}  ${device.name} (${device.scope})`
  )
  for (const deviceId of result.notFound) {
    lines.push(`No paired device with id ${deviceId}; see \`orca devices list\`.`)
  }
  if (result.revoked.length > 0) {
    lines.push(
      source === 'running'
        ? 'Their connections were closed, and their relay credentials and push registrations are being withdrawn.'
        : 'No Orca is running for this profile, so the devices were removed from the registry on disk. They cannot sign in again; their relay credentials and push registrations are withdrawn when Orca next starts.'
    )
  } else if (result.notFound.length === 0) {
    lines.push('No paired devices to revoke.')
  }
  return lines.join('\n')
}
