import { describe, expect, it } from 'vitest'
import type { DeviceRegistry } from '../../rpc/server/pairing/device-registry'
import type { RelayRevokeOutbox } from '../pairing/relay-revoke-outbox'
import { RelayDemandLedger } from './relay-demand-ledger'

const NOW = 1_800_000_000_000

function ledgerWithInviteExpiry(inviteExpiresAt: number | undefined): RelayDemandLedger {
  const devices = [
    {
      scope: 'mobile',
      relayBinding: {
        relayHostId: 'riFsLvUkejeCwTXv',
        relayDeviceId: 'device-1',
        ownerIdentityKey: 'owner',
        inviteExpiresAt
      }
    }
  ]
  return new RelayDemandLedger({
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the ledger only lists devices.
    deviceRegistry: { listDevices: () => devices } as unknown as DeviceRegistry,
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the ledger only reads pending revokes.
    revokeOutbox: { pendingFor: () => [] } as unknown as RelayRevokeOutbox,
    relayHostId: 'riFsLvUkejeCwTXv',
    now: () => NOW
  })
}

describe('RelayDemandLedger invite expiry', () => {
  it('holds demand and schedules expiry for an invite inside its lifetime', () => {
    const ledger = ledgerWithInviteExpiry(NOW + 600_000)

    expect(ledger.hasDemand('owner')).toBe(true)
    expect(ledger.nextPendingExpiry()).toBe(NOW + 600_000)
  })

  it.each([
    ['beyond the invite lifetime plus skew', NOW + 630_001],
    ['beyond the largest timer delay', NOW + 2_147_483_648],
    ['at the largest safe integer', Number.MAX_SAFE_INTEGER]
  ])('treats a stored expiry %s as lapsed', (_name, inviteExpiresAt) => {
    const ledger = ledgerWithInviteExpiry(inviteExpiresAt)

    expect(ledger.hasDemand('owner')).toBe(false)
    expect(ledger.nextPendingExpiry()).toBeNull()
  })

  it('keeps standing demand for a device whose credential install removed the expiry', () => {
    const ledger = ledgerWithInviteExpiry(undefined)

    expect(ledger.hasDemand('owner')).toBe(true)
    expect(ledger.nextPendingExpiry()).toBeNull()
  })
})
