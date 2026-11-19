import { describe, expect, it } from 'vitest'
import {
  planConnectorFleetSync,
  type FleetPlanHost,
  type FleetPlanHub
} from './seal-connectors-fleet-plan'
import type { RefresherLease } from './seal-connectors-types'

const NOW = 10_000_000
const lease = (ownerHostKey: string | null, epoch: number, heartbeatAt = NOW): RefresherLease => ({
  ownerHostKey,
  epoch,
  heartbeatAt,
  grantedBy: 'host:hub'
})

function hub(overrides: Partial<FleetPlanHub> = {}): FleetPlanHub {
  return {
    target: 'local',
    hostKey: 'host:hub',
    versions: {},
    lease: lease('host:hub', 1),
    heartbeatAt: NOW,
    ...overrides
  }
}

function host(hostKey: string, overrides: Partial<FleetPlanHost> = {}): FleetPlanHost {
  return {
    target: hostKey,
    hostKey,
    versions: {},
    lease: lease('host:hub', 1),
    heartbeatAt: 0,
    answered: true,
    ...overrides
  }
}

describe('planConnectorFleetSync', () => {
  it('pulls the newest sign-in from the host that holds it, then pushes it to everyone behind', () => {
    const plan = planConnectorFleetSync({
      now: NOW,
      designatedHostKey: null,
      hub: hub({ versions: { a: 100, b: 50 } }),
      hosts: [
        host('host:x', { versions: { a: 300 } }),
        host('host:y', { versions: { a: 100, b: 50 } })
      ]
    })
    expect(plan.pulls).toEqual([{ target: 'host:x', ids: ['a'] }])
    expect(plan.pushes).toEqual([
      { target: 'local', ids: ['a'] },
      { target: 'host:y', ids: ['a'] },
      { target: 'host:x', ids: ['b'] }
    ])
  })

  it('moves the lease to the hub with epoch+1 once the owner has been silent for 3 minutes', () => {
    const plan = planConnectorFleetSync({
      now: NOW,
      designatedHostKey: null,
      hub: hub({ lease: lease('host:x', 4, NOW - 200_000), heartbeatAt: 0 }),
      hosts: [host('host:x', { lease: lease('host:x', 4), answered: false })]
    })
    expect(plan.lease).toEqual({
      ownerHostKey: 'host:hub',
      epoch: 5,
      heartbeatAt: NOW,
      grantedBy: 'host:hub'
    })
    expect(plan.leaseTargets).toEqual(['local'])
  })

  it('keeps an owner that missed one pass, unless a token is about to lapse', () => {
    const args = {
      now: NOW,
      designatedHostKey: null,
      hub: hub({ lease: lease('host:x', 4, NOW - 120_000), heartbeatAt: 0 }),
      hosts: [host('host:x', { lease: lease('host:x', 4), answered: false })]
    }
    expect(planConnectorFleetSync(args).lease).toEqual(lease('host:x', 4, NOW - 120_000))
    expect(planConnectorFleetSync({ ...args, urgent: true }).lease.ownerHostKey).toBe('host:hub')
  })

  it('leaves a lease another desktop granted alone while its owner is alive', () => {
    const plan = planConnectorFleetSync({
      now: NOW,
      designatedHostKey: null,
      hub: hub({ lease: lease('host:hub', 3, NOW - 900_000), heartbeatAt: 0 }),
      hosts: [host('host:y', { lease: lease('host:other-desktop', 4, NOW - 20_000) })]
    })
    expect(plan.lease).toEqual(lease('host:other-desktop', 4, NOW - 20_000))
  })

  it('hands the lease to the designated host once it is online', () => {
    const plan = planConnectorFleetSync({
      now: NOW,
      designatedHostKey: 'host:x',
      hub: hub({ lease: lease('host:hub', 2), heartbeatAt: NOW - 1_000 }),
      hosts: [host('host:x', { lease: lease('host:hub', 2) })]
    })
    expect(plan.lease.ownerHostKey).toBe('host:x')
    expect(plan.lease.epoch).toBe(3)
    // The outgoing owner (the hub) hears first, the new one last.
    expect(plan.leaseTargets).toEqual(['local', 'host:x'])
  })

  it('does not give a returning old owner its lease back', () => {
    const plan = planConnectorFleetSync({
      now: NOW,
      designatedHostKey: null,
      hub: hub({ lease: lease('host:hub', 6, NOW - 2_000), heartbeatAt: NOW - 2_000 }),
      hosts: [host('host:old', { lease: lease('host:old', 5), heartbeatAt: NOW - 500 })]
    })
    expect(plan.lease).toEqual({
      ownerHostKey: 'host:hub',
      epoch: 6,
      heartbeatAt: NOW - 2_000,
      grantedBy: 'host:hub'
    })
  })
})
