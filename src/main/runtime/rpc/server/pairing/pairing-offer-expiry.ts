import {
  isExpiredPairingOffer,
  isPendingTokenRow,
  sameGrants,
  type DeviceEntry,
  type TokenDeviceEntry
} from './device-entry'
import type { DeviceScope } from '../../../../../shared/remote-runtime/session-graph/runtime-session-contracts'
import type { RuntimeDeviceGrant } from '../../callers/rpc-method-permission'

export const MOBILE_PAIRING_OFFER_TTL_MS = 10 * 60_000
export const RUNTIME_PAIRING_OFFER_TTL_MS = 60 * 60_000

/** Every offer expires; desktop UI and headless `serve`/`pair` share these lifetimes. */
export function pairingOfferTtlMs(scope: DeviceScope, offerTtlMs?: number): number {
  return (
    offerTtlMs ?? (scope === 'mobile' ? MOBILE_PAIRING_OFFER_TTL_MS : RUNTIME_PAIRING_OFFER_TTL_MS)
  )
}
// A phone mid-scan keeps the old offer while re-advertisement mints a fresh one.
export const PAIRING_OFFER_REUSE_MARGIN_MS = 60_000

/** Unscanned offers, excluding rows that authenticated this session but failed to persist it. */
export function pendingPairingOffers(
  devices: readonly DeviceEntry[],
  scope: DeviceScope,
  seen: ReadonlySet<string>
): TokenDeviceEntry[] {
  return devices.filter(
    (d): d is TokenDeviceEntry => isPendingTokenRow(d) && d.scope === scope && !seen.has(d.deviceId)
  )
}

/** An offer about to lapse is not handed out again; the caller mints a fresh one. */
export function reusablePairingOffer(
  offers: readonly TokenDeviceEntry[],
  grants: readonly RuntimeDeviceGrant[],
  now = Date.now()
): TokenDeviceEntry | null {
  return (
    offers.find(
      (d) =>
        sameGrants(d, grants) &&
        d.offerExpiresAt !== undefined &&
        d.offerExpiresAt - now > PAIRING_OFFER_REUSE_MARGIN_MS
    ) ?? null
  )
}

/** Expired never-seen offers safe to drop: not seen this session and not anyone's parent. */
export function expiredPairingOffers(
  devices: readonly DeviceEntry[],
  seen: ReadonlySet<string>,
  now = Date.now()
): DeviceEntry[] {
  const parents = new Set(devices.flatMap((d) => [d.parentDeviceId, d.forkedFrom]))
  return devices.filter(
    (d) => isExpiredPairingOffer(d, now) && !seen.has(d.deviceId) && !parents.has(d.deviceId)
  )
}

export function withoutExpiredUnboundOffers(
  devices: DeviceEntry[],
  seen: ReadonlySet<string>
): DeviceEntry[] {
  const unbound = new Set(expiredPairingOffers(devices, seen).filter((d) => !d.relayBinding))
  return unbound.size === 0 ? devices : devices.filter((d) => !unbound.has(d))
}
