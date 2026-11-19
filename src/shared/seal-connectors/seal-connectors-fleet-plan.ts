import type { RefresherLease } from './seal-connectors-types'

/** An owner that has not stamped its heartbeat for this long has lost the lease. */
export const LEASE_STALE_MS = 3 * 60_000

type SignInVersions = Record<string, number>

export type FleetPlanHub = {
  /** What the hub is called when pulls and pushes name a host. */
  target: string
  hostKey: string | null
  versions: SignInVersions
  lease: RefresherLease
  /** The hub's own heartbeat stamp; only meaningful when it owns the lease. */
  heartbeatAt: number
  /** False when it has no secret store (e.g. no OS keyring): it can never refresh. */
  canHoldSignIns?: boolean
}

export type FleetPlanHost = {
  target: string
  hostKey: string
  versions: SignInVersions
  lease: RefresherLease
  /** The host's own heartbeat stamp, on the hub's clock; only meaningful when it owns the lease. */
  heartbeatAt: number
  /** False when the host did not reply this pass; it is then neither read from nor written to. */
  answered: boolean
  canHoldSignIns?: boolean
}

export type FleetPlan = {
  pulls: { target: string; ids: string[] }[]
  pushes: { target: string; ids: string[] }[]
  lease: RefresherLease
  /** Every host that should hear the lease, which is also how an owner is told it is confirmed. */
  leaseTargets: string[]
}

function newerLease(a: RefresherLease, b: RefresherLease): RefresherLease {
  if (a.epoch !== b.epoch) {
    return a.epoch > b.epoch ? a : b
  }
  return (a.ownerHostKey ?? '') <= (b.ownerHostKey ?? '') ? a : b
}

function planSignIns(
  hub: FleetPlanHub,
  online: readonly FleetPlanHost[]
): Pick<FleetPlan, 'pulls' | 'pushes'> {
  const holders = [{ target: hub.target, versions: hub.versions }, ...online]
  const ids = new Set(holders.flatMap((holder) => Object.keys(holder.versions)))
  const pulls = new Map<string, string[]>()
  const pushes = new Map<string, string[]>()
  for (const id of [...ids].sort()) {
    // The hub is first, so it is the source when it already holds the newest copy.
    const source = holders.reduce((best, holder) =>
      (holder.versions[id] ?? -1) > (best.versions[id] ?? -1) ? holder : best
    )
    const newest = source.versions[id] ?? -1
    if (source.target !== hub.target) {
      pulls.set(source.target, [...(pulls.get(source.target) ?? []), id])
    }
    for (const holder of holders) {
      if ((holder.versions[id] ?? -1) < newest) {
        pushes.set(holder.target, [...(pushes.get(holder.target) ?? []), id])
      }
    }
  }
  const list = (map: Map<string, string[]>) =>
    [...map.entries()].map(([target, targetIds]) => ({ target, ids: targetIds }))
  return { pulls: list(pulls), pushes: list(pushes) }
}

/** With a token about to lapse, an owner silent this long is replaced sooner. */
export const LEASE_URGENT_STALE_MS = 90_000

function planLease(args: {
  now: number
  designatedHostKey: string | null
  hub: FleetPlanHub
  online: readonly FleetPlanHost[]
  urgent: boolean
}): RefresherLease {
  const { now, designatedHostKey, hub, online } = args
  const current = online.reduce((best, host) => newerLease(best, host.lease), hub.lease)
  const live = new Map<string, number>()
  if (hub.hostKey) {
    live.set(hub.hostKey, hub.heartbeatAt)
  }
  for (const host of online) {
    live.set(host.hostKey, host.heartbeatAt)
  }
  // Only a host that can hold the sign-ins can renew them.
  const candidates = new Set(
    [hub, ...online].flatMap((holder) =>
      holder.hostKey && holder.canHoldSignIns !== false ? [holder.hostKey] : []
    )
  )
  const owner = current.ownerHostKey
  // The owner's last sign of life: its own stamp when it answered, else what other copies carry
  // (another desktop may be the one reaching it).
  const seenAt = Math.max(
    ...[hub.lease, ...online.map((host) => host.lease)]
      .filter((lease) => lease.epoch === current.epoch && lease.ownerHostKey === owner)
      .map((lease) => lease.heartbeatAt),
    owner && live.has(owner) ? (live.get(owner) ?? 0) : 0
  )
  const answered = owner !== null && live.has(owner)
  const designatedOnline = designatedHostKey !== null && candidates.has(designatedHostKey)
  // Only an owner that answered can be told it lost the lease, so only then may it be displaced.
  const displaced =
    answered && ((designatedOnline && designatedHostKey !== owner) || !candidates.has(owner ?? ''))
  const silentFor = now - seenAt
  const stale = silentFor >= (args.urgent ? LEASE_URGENT_STALE_MS : LEASE_STALE_MS)
  if (owner !== null && !displaced && (answered || !stale)) {
    return { ...current, heartbeatAt: seenAt }
  }
  const elected = designatedOnline
    ? designatedHostKey
    : hub.hostKey && candidates.has(hub.hostKey)
      ? hub.hostKey
      : ([...candidates].sort()[0] ?? null)
  if (elected === null) {
    return current
  }
  return {
    ownerHostKey: elected,
    epoch: elected === owner ? current.epoch : current.epoch + 1,
    heartbeatAt: now,
    grantedBy: hub.hostKey
  }
}

/**
 * What the desktop hub does this pass: which hosts to read newer sign-ins from, which to write
 * them to, and who refreshes tokens next.
 */
export function planConnectorFleetSync(args: {
  now: number
  designatedHostKey: string | null
  hub: FleetPlanHub
  hosts: readonly FleetPlanHost[]
  /** Some sign-in expires soon and nobody has renewed it. */
  urgent?: boolean
}): FleetPlan {
  const online = args.hosts.filter((host) => host.answered)
  const lease = planLease({ ...args, online, urgent: args.urgent ?? false })
  const previousOwners = new Set(
    [args.hub.lease, ...args.hosts.map((host) => host.lease)].map((entry) => entry.ownerHostKey)
  )
  // Hosts that held the lease hear first and the new owner last, so two never refresh at once.
  const rank = (hostKey: string | null): number =>
    hostKey === lease.ownerHostKey ? 2 : hostKey !== null && previousOwners.has(hostKey) ? 0 : 1
  const leaseTargets = [args.hub, ...online]
    .map((holder, index) => ({ target: holder.target, rank: rank(holder.hostKey), index }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((holder) => holder.target)
  return { ...planSignIns(args.hub, online), lease, leaseTargets }
}
