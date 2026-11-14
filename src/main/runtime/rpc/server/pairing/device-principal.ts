import { deviceTokenHashOf, type DeviceEntry } from './device-entry'
import type { RpcCallerScope } from '../../callers/rpc-caller-scope'
import { hashDeviceToken } from './device-token-hash'

/** Socket revoke/close uses deviceId; per-client drivers, dictation and file grants use clientId. */
export type DevicePrincipal = {
  deviceId: string
  scope: DeviceEntry['scope']
  // Never the bearer: other paired devices see this id (terminal driver changes).
  clientId: string
  callerFingerprint: string
  credentialRevision: number
}

export function devicePrincipalOf(device: DeviceEntry): DevicePrincipal {
  return {
    deviceId: device.deviceId,
    scope: device.scope,
    clientId: device.deviceId,
    callerFingerprint:
      device.callerFingerprint ??
      // A stored token hash is the fingerprint of that token.
      deviceTokenHashOf(device) ??
      fingerprintAuthenticatedPairingCredential(`device:${device.deviceId}`),
    credentialRevision: device.credentialRevision ?? 0
  }
}

export function callerScopeOf(device: DeviceEntry): RpcCallerScope {
  return device.scope === 'mobile'
    ? { kind: 'mobile', delegated: device.parentDeviceId !== undefined }
    : { kind: 'runtime-paired', grants: device.grants ?? [] }
}

export function fingerprintAuthenticatedPairingCredential(token: string): string {
  return hashDeviceToken(token)
}
