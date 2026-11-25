import type { RelayDeviceBinding } from '../../../mobile-cloud-relay/pairing/relay-revoke-outbox'
import type { DeviceEntry } from './device-entry'

export type DeviceRevocationSteps = {
  registry: {
    listDevices(): readonly DeviceEntry[]
    /** A row already gone (removed on disk by another writer) is not an error. */
    removeDevice(deviceId: string): boolean
  }
  /** False when the cloud credential's cleanup could not be made durable. */
  queueRelayDeviceRevoke(binding: RelayDeviceBinding): boolean
  queuePushUnregister(deviceId: string, registrationId: string | undefined): void
  /** After the row is gone: cut whatever the device still holds in this process. */
  onRevoked?(device: DeviceEntry): void
}

/**
 * The one revoke: `roots` and every device paired through them (delegated phones, key forks) lose
 * their rows, relay credentials and push registrations. `roots` may already be absent from the
 * registry (removed on disk); their cleanup still runs. Returns the devices revoked, or null when
 * a cleanup could not be made durable: the remaining rows stay in place so a retry finds them.
 */
export function revokeDevices(
  roots: readonly DeviceEntry[],
  steps: DeviceRevocationSteps
): DeviceEntry[] | null {
  // Saves adopt disk deletions, so capture every descendant's cleanup facts before the first write.
  const paired = steps.registry.listDevices()
  const plan: DeviceEntry[] = []
  const visited = new Set<string>()
  const visit = (device: DeviceEntry): void => {
    if (visited.has(device.deviceId)) {
      return
    }
    visited.add(device.deviceId)
    for (const child of paired) {
      if (child.parentDeviceId === device.deviceId || child.forkedFrom === device.deviceId) {
        visit(child)
      }
    }
    plan.push(device)
  }
  roots.forEach(visit)
  for (const device of plan) {
    // Keep ancestors until child cleanup is durable so retry can rediscover them.
    if (device.scope === 'mobile') {
      if (device.relayBinding && !steps.queueRelayDeviceRevoke(device.relayBinding)) {
        return null
      }
      steps.queuePushUnregister(device.deviceId, device.pushRegistration?.registrationId)
    }
    steps.registry.removeDevice(device.deviceId)
    steps.onRevoked?.(device)
  }
  return plan
}
