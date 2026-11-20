import type {
  RelayDeviceBinding,
  RelayRevokeOutboxItem
} from '../../mobile-cloud-relay/pairing/relay-revoke-outbox'
import type {
  DelegatedPhone,
  DelegatedMobileDeviceSyncResult
} from '../../../../shared/delegated-mobile-device-contract'
import type { DeviceEntry } from './pairing/device-entry'
import { revokeDevices } from './pairing/device-revocation'
import { revokeNamedPairedDevices, summarizePairedDevice } from './pairing/paired-device-summary'
import type { PairedDevicesRpcContext } from '../core'
import { RuntimeRpcRequestAdmission } from './runtime-rpc-request-admission'

// Why: below dispatch so a caller-bound RPC context can revoke and mint mobile devices.
export class RuntimeRpcMobileDevices extends RuntimeRpcRequestAdmission {
  private onPushUnregisterQueued?: () => void

  async revokeMobileDevice(deviceId: string): Promise<boolean> {
    const device = this.deviceRegistry?.getDevice(deviceId)
    return device?.scope === 'mobile' && this.revokeDevicesNow([device]) !== null
  }

  revokeRuntimeAccess(deviceId: string): boolean {
    const device = this.deviceRegistry?.getDevice(deviceId)
    return device?.scope === 'runtime' && this.revokeDevicesNow([device]) !== null
  }

  /** Rows another writer removed from the registry file, or that expired: finish them as revokes. */
  protected revokeRemovedOrExpiredDevices(devices: readonly DeviceEntry[]): void {
    this.revokeDevicesNow(devices)
  }

  // The desktop's Settings and the owner's CLI revoke through the same path.
  protected override ownerPairedDevices(): PairedDevicesRpcContext {
    return {
      list: () => ({
        devices: (this.deviceRegistry?.listDevices() ?? []).map(summarizePairedDevice)
      }),
      revoke: (params) => {
        const registry = this.deviceRegistry
        if (!registry) {
          throw new Error('device_registry_unavailable')
        }
        return revokeNamedPairedDevices(registry.listDevices(), params, (roots) =>
          this.revokeDevicesNow(roots)
        )
      }
    }
  }

  private revokeDevicesNow(roots: readonly DeviceEntry[]): DeviceEntry[] | null {
    const registry = this.deviceRegistry
    if (!registry) {
      return null
    }
    const revoked = revokeDevices(roots, {
      registry,
      queueRelayDeviceRevoke: (binding) => this.queueRelayDeviceRevoke(binding),
      queuePushUnregister: (deviceId, registrationId) =>
        this.queuePushUnregister(deviceId, registrationId),
      onRevoked: (device) => {
        if (device.scope === 'mobile') {
          this.mobileRelayPairingProvider?.onDemandStateChanged?.()
        }
        this.runtime.forgetClientNavigationState(device.deviceId)
        this.mobileSocketWiring?.terminateDeviceConnections(device.deviceId)
      }
    })
    if (revoked?.some((device) => device.scope === 'mobile' && !device.parentDeviceId)) {
      this.mobileDesktopRelay?.phonesChanged()
    }
    return revoked
  }

  /** Make the runtime device `parentDeviceId`'s phones exactly `phones`; dropped ones are fully revoked. */
  protected syncDelegatedMobileDevices(
    parentDeviceId: string,
    phones: readonly DelegatedPhone[]
  ): DelegatedMobileDeviceSyncResult {
    const registry = this.deviceRegistry
    const parent = registry?.getDevice(parentDeviceId)
    if (!registry || parent?.scope !== 'runtime') {
      throw new Error('delegated_device_parent_unavailable')
    }
    const wanted = new Set(phones.map((phone) => phone.phoneKey))
    const dropped = registry
      .listDelegatedMobileDevices(parentDeviceId)
      .filter((child) => !child.phoneKey || !wanted.has(child.phoneKey))
    if (!this.revokeDevicesNow(dropped)) {
      throw new Error('delegated_device_revoke_failed')
    }

    let devices = registry.upsertDelegatedMobileDevices(parent, phones)
    // A child removed on disk meanwhile is dropped by the save; one rerun mints it fresh.
    if (devices.length < phones.length) {
      const current = registry.getDevice(parentDeviceId)
      if (current?.scope !== 'runtime') {
        throw new Error('delegated_device_parent_unavailable')
      }
      devices = registry.upsertDelegatedMobileDevices(current, phones)
    }
    return {
      devices: devices.map(({ phoneKey, deviceId, token }) => ({ phoneKey, deviceId, token }))
    }
  }

  /** Best-effort: a failed enqueue must never block the revoke the user asked for. */
  protected queuePushUnregister(deviceId: string, registrationId: string | undefined): void {
    if (!registrationId) {
      return
    }
    try {
      this.pushUnregisterOutbox.enqueue({ registrationId, deviceId })
      this.onPushUnregisterQueued?.()
    } catch (error) {
      console.error('[runtime] Failed to persist a push token cleanup:', error)
    }
  }

  setOnPushUnregisterQueued(callback: (() => void) | null): void {
    this.onPushUnregisterQueued = callback ?? undefined
  }

  protected queueRelayDeviceRevoke(binding: RelayDeviceBinding): boolean {
    let item: RelayRevokeOutboxItem
    try {
      item = this.relayRevokeOutbox.enqueue(binding)
    } catch (error) {
      console.error('[runtime] Failed to persist Relay device cleanup:', error)
      return false
    }
    try {
      this.mobileRelayPairingProvider?.onDeviceRevokeQueued(item)
    } catch (error) {
      console.warn('[runtime] Failed to notify Relay cleanup worker:', error)
    }
    return true
  }
}
