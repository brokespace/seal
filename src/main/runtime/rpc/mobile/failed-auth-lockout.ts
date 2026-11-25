// Slows credential guessing: a source that keeps failing sign-in is refused for a doubling, bounded time.
import type { MobileSocketTransportMetadata } from './mobile-socket-wiring'

// A stale phone retries its sign-in a couple of times before giving up; only persistence is punished.
const FAILURES_BEFORE_LOCKOUT = 3
const FIRST_LOCKOUT_MS = 1000
// Bounded so loopback (this machine, SSH forwards) can never lock its owner out for good.
const MAX_LOCKOUT_MS = 5 * 60_000
const FAILURE_MEMORY_MS = 15 * 60_000
const MAX_TRACKED_SOURCES = 4096

type SourceFailures = { failures: number; lockedUntil: number; lastFailureAt: number }

/** Null for a peer with nothing to count failures against; it is never locked out. */
export function authLockoutSource(metadata: MobileSocketTransportMetadata): string | null {
  if (metadata.transport === 'relay') {
    // The Relay vouches for which device this is, so one device's failures cannot lock out another.
    return `relay:${metadata.relayHostId}:${metadata.relayDeviceId}`
  }
  return metadata.sourceKey ? `direct:${metadata.sourceKey}` : null
}

export class FailedAuthLockout {
  private readonly sources = new Map<string, SourceFailures>()

  constructor(private readonly now: () => number = Date.now) {}

  isLockedOut(source: string | null): boolean {
    const entry = source === null ? undefined : this.sources.get(source)
    return entry !== undefined && entry.lockedUntil > this.now()
  }

  /** Counts a close that means the peer presented a credential the host refused. */
  noteSignInClosed(source: string | null, code: number, reason: string): void {
    if (
      source !== null &&
      code === 4001 &&
      ['Unauthorized', 'Invalid e2ee_auth'].includes(reason)
    ) {
      this.noteFailure(source)
    }
  }

  private noteFailure(source: string): void {
    const now = this.now()
    const previous = this.sources.get(source)
    const remembered =
      previous && now - Math.max(previous.lastFailureAt, previous.lockedUntil) < FAILURE_MEMORY_MS
    const failures = (remembered ? previous.failures : 0) + 1
    const lockoutMs =
      failures < FAILURES_BEFORE_LOCKOUT
        ? 0
        : Math.min(FIRST_LOCKOUT_MS * 2 ** (failures - FAILURES_BEFORE_LOCKOUT), MAX_LOCKOUT_MS)
    // Re-inserted so the map's order is oldest failure first.
    this.sources.delete(source)
    this.sources.set(source, { failures, lockedUntil: now + lockoutMs, lastFailureAt: now })
    this.forgetOldest()
  }

  noteSuccess(source: string | null): void {
    if (source !== null) {
      this.sources.delete(source)
    }
  }

  private forgetOldest(): void {
    for (const source of this.sources.keys()) {
      if (this.sources.size <= MAX_TRACKED_SOURCES) {
        return
      }
      this.sources.delete(source)
    }
  }
}
