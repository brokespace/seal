import { mintDeviceCredential } from './device-credential'
import type { DelegatedPhone } from '../../../../../shared/delegated-mobile-device-contract'
import type { DeviceEntry } from './device-entry'
import { hashDeviceToken } from './device-token-hash'

/** A child's row id with the bearer its parent desktop presents for it; the bearer is never stored. */
export type DelegatedMobileDeviceGrant = { phoneKey: string; deviceId: string; token: string }

type DelegatedMobileDeviceRow = DeviceEntry & { parentDeviceId: string; phoneKey: string }

export function planDelegatedMobileDevices(
  devices: DeviceEntry[],
  parent: DeviceEntry,
  phones: readonly DelegatedPhone[],
  // Bearers minted since this process started; a child whose bearer is not here gets a new one.
  heldTokens: ReadonlyMap<string, string> = new Map(),
  now = Date.now()
): { nextDevices: DeviceEntry[]; grants: DelegatedMobileDeviceGrant[] } {
  // A parent removed meanwhile (e.g. on disk) must not mint children nobody can revoke with it.
  if (!devices.some((device) => device.deviceId === parent.deviceId)) {
    return { nextDevices: devices, grants: [] }
  }
  let nextDevices = devices
  const grants = phones.map((phone) => {
    const existing = nextDevices.find(
      (device): device is DelegatedMobileDeviceRow =>
        device.parentDeviceId === parent.deviceId && device.phoneKey === phone.phoneKey
    )
    const heldToken = existing ? heldTokens.get(existing.deviceId) : undefined
    if (existing && heldToken !== undefined && existing.name === phone.name) {
      return { phoneKey: phone.phoneKey, deviceId: existing.deviceId, token: heldToken }
    }
    const credential = mintDeviceCredential()
    const row: DeviceEntry = existing
      ? {
          ...existing,
          name: phone.name,
          ...(heldToken === undefined
            ? {
                tokenHash: hashDeviceToken(credential.token),
                // Sockets on the bearer this host no longer holds end with it.
                credentialRevision: (existing.credentialRevision ?? 0) + 1
              }
            : {})
        }
      : {
          deviceId: credential.deviceId,
          tokenHash: hashDeviceToken(credential.token),
          name: phone.name,
          scope: 'mobile',
          pairedAt: now,
          // QR rotation targets lastSeenAt === 0; delegated children must never be pending offers.
          lastSeenAt: now,
          pairingReach: parent.pairingReach ?? 'network',
          parentDeviceId: parent.deviceId,
          phoneKey: phone.phoneKey
        }
    nextDevices = existing
      ? nextDevices.map((device) => (device === existing ? row : device))
      : [...nextDevices, row]
    return {
      phoneKey: phone.phoneKey,
      deviceId: row.deviceId,
      token: heldToken ?? credential.token
    }
  })
  return { nextDevices, grants }
}
