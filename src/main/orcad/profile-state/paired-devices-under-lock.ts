// CLI entry for `orca devices` while no Orca runs for the profile; plain Node, loaded from the packaged CLI.
import { existsSync } from 'node:fs'
import type {
  PairedDevicesListResult,
  PairedDevicesRevokeParams,
  PairedDevicesRevokeResult
} from '../../../shared/paired-device-admin-contract'
import { RelayRevokeOutbox } from '../../runtime/mobile-cloud-relay/pairing/relay-revoke-outbox'
import { PushUnregisterOutbox } from '../../runtime/push/push-unregister-outbox'
import { revokeDevices } from '../../runtime/rpc/server/pairing/device-revocation'
import { DeviceRegistry } from '../../runtime/rpc/server/pairing/device-registry'
import {
  revokeNamedPairedDevices,
  summarizePairedDevice
} from '../../runtime/rpc/server/pairing/paired-device-summary'
import { OrcadInstanceLockError } from '../instance-lock/orcad-data-root-privacy'
import { acquireOrcadInstanceLock } from '../instance-lock/orcad-instance-lock'

export type PairedDevicesUnderLockResult<T> =
  | { status: 'done'; value: T }
  | { status: 'missing' }
  /** An Orca serves this profile; its RPC owns the registry. */
  | { status: 'running'; message: string }

const RUNNING_LOCK_CODES: ReadonlySet<string> = new Set([
  'orcad_instance_lock_held',
  'orcad_instance_lock_holder_unverifiable'
])

/** Holds the profile lock so no Orca starts and serves a device mid-revoke. */
function underProfileLock<T>(userDataPath: string, run: () => T): PairedDevicesUnderLockResult<T> {
  if (!existsSync(userDataPath)) {
    return { status: 'missing' }
  }
  let lock: ReturnType<typeof acquireOrcadInstanceLock>
  try {
    // The path may be a desktop profile, whose permissions this must not change.
    lock = acquireOrcadInstanceLock(userDataPath, { enforcePrivateDataRoot: false })
  } catch (error) {
    if (error instanceof OrcadInstanceLockError && RUNNING_LOCK_CODES.has(error.code)) {
      return { status: 'running', message: error.message }
    }
    throw error
  }
  try {
    return { status: 'done', value: run() }
  } finally {
    // Not a run; the next start must still report a crash that preceded it.
    lock.release({ keepUnexpectedExit: true })
  }
}

export function listPairedDevicesUnderLock(
  userDataPath: string
): PairedDevicesUnderLockResult<PairedDevicesListResult> {
  return underProfileLock(userDataPath, () => ({
    devices: new DeviceRegistry(userDataPath).listDevices().map(summarizePairedDevice)
  }))
}

/**
 * The same revoke the running server performs, minus its live sockets (there are none): rows are
 * removed and the relay and push cleanups are queued durably, to be sent by the next start.
 */
export function revokePairedDevicesUnderLock(
  userDataPath: string,
  params: PairedDevicesRevokeParams
): PairedDevicesUnderLockResult<PairedDevicesRevokeResult> {
  return underProfileLock(userDataPath, () => {
    const registry = new DeviceRegistry(userDataPath)
    const relayRevokes = new RelayRevokeOutbox(userDataPath)
    const pushUnregisters = new PushUnregisterOutbox(userDataPath)
    return revokeNamedPairedDevices(registry.listDevices(), params, (roots) =>
      revokeDevices(roots, {
        registry,
        queueRelayDeviceRevoke: (binding) => {
          try {
            relayRevokes.enqueue(binding)
            return true
          } catch {
            return false
          }
        },
        queuePushUnregister: (deviceId, registrationId) => {
          if (!registrationId) {
            return
          }
          try {
            pushUnregisters.enqueue({ registrationId, deviceId })
          } catch {
            // Best-effort, as in the running server: the revoke itself must not fail on it.
          }
        }
      })
    )
  })
}
