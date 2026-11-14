import type { DeviceScope } from '../../../../../shared/runtime-session-contracts'
import type { MobilePairingConnectionMode } from '../../../../../shared/remote-runtime/pairing/mobile-pairing-connection-mode'
import type { MobilePushRegistration } from '../../../../../shared/mobile-push-contract'
import type { RuntimePairingReach } from '../../../../../shared/runtime-pairing-reach'
import type { RelayDeviceBinding } from '../../../mobile-cloud-relay/pairing/relay-revoke-outbox'
import type { RuntimeDeviceGrant } from '../../callers/rpc-method-permission'
import type { NetworkSourceClass } from '../../transports/websocket/source-admission/network-source-class'
import { hashDeviceToken, sameDeviceTokenHash } from './device-token-hash'

// Matches the Relay's resume-credential lifetime: a bearer unused this long stops authenticating.
export const DEVICE_TOKEN_IDLE_TTL_MS = 30 * 24 * 60 * 60_000

export type DeviceEntry = {
  deviceId: string
  name: string
  // Plaintext only while an unscanned offer, which must stay displayable; first sign-in hashes it.
  token?: string
  // SHA-256 of a used bearer. Keyed rows have neither, so older builds cannot authenticate them.
  tokenHash?: string
  scope: DeviceScope
  pairedAt: number
  lastSeenAt: number
  // Where its latest direct (non-Relay) connection came from; absent until one after this field shipped.
  lastSourceClass?: NetworkSourceClass
  relayBinding?: RelayDeviceBinding
  mobilePairingConnectionMode?: MobilePairingConnectionMode
  // STA-2370: local-only grants prove no off-host reach for listener binding.
  pairingReach?: RuntimePairingReach
  // Persist push across desktop restart; older registries have none.
  pushRegistration?: MobilePushRegistration
  // Relayed phones lose access with their parent desktop grant.
  parentDeviceId?: string
  phoneKey?: string
  // Grant only at pairing; absent on older rows means no administrative powers.
  grants?: RuntimeDeviceGrant[]
  // Credential changes invalidate bound sockets; absent revision is 0.
  credentialRevision?: number
  // Preserve orchestration ownership across credential change; absent defaults to sha256(token).
  callerFingerprint?: string
  // Absent means bearer row; device-key rows require this public key's proof.
  credentialKind?: 'device-key'
  devicePublicKeyB64?: string
  // The token row this installation migrated from; that row stays for its other holders.
  forkedFrom?: string
  // Session-only browser key (memory only); the row is dropped on host restart and after idling.
  ephemeral?: true
  // A never-seen offer stops authenticating here; one without it (older builds) is already expired.
  offerExpiresAt?: number
  // Last sign-in used the older E2EE framing (set then; a v2 sign-in clears it). Local-only notice data.
  legacyE2EEAuthAt?: number
  // Minted as a pairing offer by a host that can exchange it; clients that never exchange keep using it.
  ticket?: true
  // Hash of the client-chosen replacement; first sign-in with it retires the pairing token (see pairing-ticket-exchange.ts).
  exchangeTokenHash?: string
  // First sign-in with a ticket; exchange is offered only shortly after it.
  ticketFirstSeenAt?: number
  // A plain-http browser re-registers a session-only key from this link on each page load.
  servesSessionBrowsers?: true
}

export type TokenDeviceEntry = DeviceEntry & { token: string }

export type DeviceKeyLookup =
  | { kind: 'found'; device: DeviceEntry & { devicePublicKeyB64: string } }
  | { kind: 'unknown' }
  // An unusable key is not revocation evidence.
  | { kind: 'not-keyed' }
  | { kind: 'refused' }
  | { kind: 'unavailable' }

// Only unscanned token rows are rotatable pairing offers; keyed rows never are.
export function isPendingTokenRow(device: DeviceEntry): device is TokenDeviceEntry {
  return (
    device.lastSeenAt === 0 && device.token !== undefined && device.credentialKind === undefined
  )
}

export function deviceTokenHashOf(device: DeviceEntry): string | undefined {
  return (
    device.tokenHash ?? (device.token !== undefined ? hashDeviceToken(device.token) : undefined)
  )
}

/** The row as stored once its bearer has been used: the hash, never the bearer. */
export function withoutUsedPlaintextToken(device: DeviceEntry): DeviceEntry {
  if (device.token === undefined || device.lastSeenAt === 0) {
    return device
  }
  const { token, ...rest } = device
  return { ...rest, tokenHash: hashDeviceToken(token) }
}

export function isExpiredPairingOffer(device: DeviceEntry, now: number): boolean {
  if (device.lastSeenAt !== 0) {
    return false
  }
  return device.offerExpiresAt === undefined
    ? device.credentialKind === undefined
    : device.offerExpiresAt <= now
}

/** Keyed rows prove possession on every sign-in, so only bearers age out. */
export function isIdleExpiredBearer(device: DeviceEntry, now: number): boolean {
  return (
    device.credentialKind === undefined &&
    device.lastSeenAt > 0 &&
    now - device.lastSeenAt > DEVICE_TOKEN_IDLE_TTL_MS
  )
}

export function sameGrants(entry: DeviceEntry, grants: readonly RuntimeDeviceGrant[]): boolean {
  const current = entry.grants ?? []
  return current.length === grants.length && current.every((grant) => grants.includes(grant))
}

// Clients erase keys on unknown; reserve that verdict for readable absence.
export function lookupDeviceKeyRow(
  device: DeviceEntry | null,
  devices: readonly DeviceEntry[]
): DeviceKeyLookup {
  if (!device) {
    return { kind: 'unknown' }
  }
  if (device.credentialKind !== 'device-key' || !device.devicePublicKeyB64) {
    return { kind: 'not-keyed' }
  }
  return withPairedParent(device, devices)
    ? { kind: 'found', device: { ...device, devicePublicKeyB64: device.devicePublicKeyB64 } }
    : { kind: 'refused' }
}

export type AuthenticatedPrincipalBinding = {
  deviceId: string
  credentialRevision: number
  deviceToken?: string
}

export function isStillAuthenticated(
  device: DeviceEntry,
  principal: AuthenticatedPrincipalBinding,
  now = Date.now()
): boolean {
  if ((device.credentialRevision ?? 0) !== principal.credentialRevision) {
    return false
  }
  if (principal.deviceToken === undefined) {
    // A keyed socket cannot survive replacement by a bearer row.
    return device.credentialKind === 'device-key'
  }
  return (
    !isIdleExpiredBearer(device, now) &&
    holdsBearerHash(device, hashDeviceToken(principal.deviceToken))
  )
}

function holdsBearerHash(device: DeviceEntry, presentedHash: string): boolean {
  return (
    sameDeviceTokenHash(deviceTokenHashOf(device), presentedHash) ||
    // Signed in with the replacement while retiring the pairing token failed to persist.
    sameDeviceTokenHash(device.exchangeTokenHash, presentedHash)
  )
}

// Forks and delegated phones lose authority with any ancestor pairing.
export function withPairedParent(
  device: DeviceEntry,
  devices: readonly DeviceEntry[],
  ancestors = new Set<string>()
): DeviceEntry | null {
  if (ancestors.has(device.deviceId)) {
    return null
  }
  ancestors.add(device.deviceId)
  const paired = [device.parentDeviceId, device.forkedFrom].every((parentId) => {
    if (parentId === undefined) {
      return true
    }
    const parent = devices.find((candidate) => candidate.deviceId === parentId)
    return parent !== undefined && withPairedParent(parent, devices, ancestors) !== null
  })
  ancestors.delete(device.deviceId)
  return paired ? device : null
}

export function findTokenDevice(
  devices: readonly DeviceEntry[],
  token: string,
  // Sightings whose persist failed still count, or a connected client would be locked out.
  seen: ReadonlySet<string> = new Set(),
  now = Date.now()
): DeviceEntry | null {
  const presentedHash = hashDeviceToken(token)
  const device =
    token &&
    devices.find((d) => d.credentialKind === undefined && holdsBearerHash(d, presentedHash))
  if (
    !device ||
    (isExpiredPairingOffer(device, now) && !seen.has(device.deviceId)) ||
    isIdleExpiredBearer(device, now)
  ) {
    return null
  }
  return withPairedParent(device, devices)
}

export function findPrincipalDevice(
  devices: readonly DeviceEntry[],
  principal: AuthenticatedPrincipalBinding
): DeviceEntry | null {
  const device = devices.find((d) => d.deviceId === principal.deviceId)
  return device && isStillAuthenticated(device, principal)
    ? withPairedParent(device, devices)
    : null
}

export function mobilePairingConnectionModeOf(
  device: DeviceEntry | null
): MobilePairingConnectionMode | null {
  if (device?.scope !== 'mobile') {
    return null
  }
  // Legacy pairings used automatic direct-first Relay fallback.
  return device.mobilePairingConnectionMode === 'local-only' ? 'local-only' : 'automatic'
}
