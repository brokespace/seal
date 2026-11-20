import { LEASE_URGENT_STALE_MS } from '../../shared/seal-connectors/seal-connectors-fleet-plan'
import type { RefresherLease } from '../../shared/seal-connectors/seal-connectors-types'

// Expires well before the hub may replace a silent owner, so two hosts never refresh at once.
export const LEASE_CONFIRMATION_MS = LEASE_URGENT_STALE_MS / 2

function outranks(next: RefresherLease, current: RefresherLease): boolean {
  if (next.epoch !== current.epoch) {
    return next.epoch > current.epoch
  }
  return (
    next.ownerHostKey === current.ownerHostKey ||
    (next.ownerHostKey ?? '') < (current.ownerHostKey ?? '')
  )
}

/** This host's view of who refreshes tokens, and whether the hub has vouched for it lately. */
export class RefresherLeaseState {
  /** The lease the hub last confirmed to this process, and when; null until it does. */
  private confirmed: { epoch: number; at: number } | null = null

  constructor(
    private lease: RefresherLease,
    private readonly self: { hostKey: () => string | null; now: () => number },
    private readonly persist: (lease: RefresherLease) => void
  ) {}

  current(): RefresherLease {
    return this.lease
  }

  owns(): boolean {
    return this.lease.ownerHostKey !== null && this.lease.ownerHostKey === this.self.hostKey()
  }

  /**
   * Takes the hub's lease when it outranks this host's view. A lease naming this host also
   * confirms it: the hub just heard from it, which is what lets it refresh tokens.
   * Returns whether it was taken and whether the owner or epoch changed.
   */
  accept(next: RefresherLease): { accepted: boolean; moved: boolean } {
    if (!outranks(next, this.lease)) {
      return { accepted: false, moved: false }
    }
    const mine = next.ownerHostKey !== null && next.ownerHostKey === this.self.hostKey()
    const moved = next.epoch !== this.lease.epoch || next.ownerHostKey !== this.lease.ownerHostKey
    this.lease = mine ? { ...next, heartbeatAt: this.self.now() } : next
    this.confirmed = mine ? { epoch: next.epoch, at: this.self.now() } : null
    if (moved) {
      this.persist(this.lease)
    }
    return { accepted: true, moved }
  }

  /** True when this host owns the lease and the hub confirmed it within LEASE_CONFIRMATION_MS. */
  mayRefresh(): boolean {
    const confirmed = this.confirmed
    return (
      this.owns() &&
      confirmed !== null &&
      confirmed.epoch === this.lease.epoch &&
      this.self.now() - confirmed.at < LEASE_CONFIRMATION_MS
    )
  }

  clearConfirmation(): void {
    this.confirmed = null
  }

  stampHeartbeat(): void {
    this.lease = { ...this.lease, heartbeatAt: this.self.now() }
  }
}
