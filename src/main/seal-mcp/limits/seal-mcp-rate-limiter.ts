const MAX_BUCKETS = 4_096

type Bucket = { tokens: number; at: number }

/**
 * A token bucket per key: `perMinute` calls refill evenly, and a full bucket allows that many at
 * once. Keys are client ids for calls and peer addresses for failed sign-ins.
 */
export class SealMcpRateLimiter {
  private readonly buckets = new Map<string, Bucket>()

  constructor(private readonly now: () => number = Date.now) {}

  /** Takes one call. Returns 0 when admitted, else the seconds until the next call fits. */
  take(key: string, perMinute: number): number {
    const bucket = this.refill(key, perMinute)
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1
      return 0
    }
    return Math.ceil(((1 - bucket.tokens) / perMinute) * 60)
  }

  /** Seconds until `key` may try again, without taking a call. */
  retryAfter(key: string, perMinute: number): number {
    const bucket = this.refill(key, perMinute)
    return bucket.tokens >= 1 ? 0 : Math.ceil(((1 - bucket.tokens) / perMinute) * 60)
  }

  private refill(key: string, perMinute: number): Bucket {
    const at = this.now()
    const known = this.buckets.get(key)
    if (!known) {
      if (!this.hasRoom(at)) {
        // Too many distinct keys at once: refuse the newcomer rather than forget who was limited.
        return { tokens: 0, at }
      }
      const fresh = { tokens: perMinute, at }
      this.buckets.set(key, fresh)
      return fresh
    }
    known.tokens = Math.min(perMinute, known.tokens + ((at - known.at) / 60_000) * perMinute)
    known.at = at
    return known
  }

  /** Idle keys are forgotten, so a flood of distinct peers cannot grow the map without bound. */
  private hasRoom(at: number): boolean {
    if (this.buckets.size < MAX_BUCKETS) {
      return true
    }
    for (const [key, bucket] of this.buckets) {
      if (at - bucket.at > 60_000) {
        this.buckets.delete(key)
      }
    }
    return this.buckets.size < MAX_BUCKETS
  }
}
