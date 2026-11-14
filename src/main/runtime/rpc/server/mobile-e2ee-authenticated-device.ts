import type { DeviceEntry } from './pairing/device-entry'
import { devicePrincipalOf, type DevicePrincipal } from './pairing/device-principal'

export type E2EEAuthenticatedDevice = DevicePrincipal & {
  // Absent for a keyed row, which never presented a bearer.
  deviceToken?: string
}

/** The registry keeps only a bearer's hash, so the socket remembers the one it presented. */
export function authenticatedDeviceOf(
  device: DeviceEntry,
  deviceToken?: string
): E2EEAuthenticatedDevice {
  return { ...devicePrincipalOf(device), ...(deviceToken !== undefined ? { deviceToken } : {}) }
}
