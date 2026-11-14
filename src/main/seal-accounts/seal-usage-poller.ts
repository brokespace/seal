import type { ProviderRateLimits } from '../../shared/rate-limit-types'
import {
  SEAL_PROVIDERS,
  type SealAccountKey,
  type SealAutoSwapSettings,
  type SealProvider
} from '../../shared/seal-accounts/seal-accounts-config'
import type { SealAccountCandidate } from '../../shared/seal-accounts/seal-account-candidates'
import { sealAccountKeysMatch } from '../../shared/seal-accounts/seal-account-key'
import {
  accountLines,
  relevantWindows,
  type SealWindowReading
} from '../../shared/seal-accounts/seal-usage-lines'
import {
  failureBackoffMs,
  nearLine,
  planAfterFetch,
  RECENT_429_WINDOW_MS,
  SERVE_TTL_MS
} from '../../shared/seal-accounts/seal-usage-poll-policy'
import type { SealUsageSample } from '../../shared/seal-accounts/seal-swap-estimate'

/** claude-swap's `cswap auto` loop interval: re-plan at least once a minute. */
const MAX_SLEEP_MS = 60_000
const MIN_SLEEP_MS = 1_000

/** Asking for fresh numbers re-reads an account at most this often. */
const MANUAL_REFRESH_FLOOR_MS = 30_000

type Entry = {
  latest: SealUsageSample | null
  previous: SealUsageSample | null
  nextPollAt: number
  intervalMs: number | null
  last429At: number | null
  failures: number
  fetchedAt: number
}

/**
 * Reads one account through the rate-limit service, which stays the only holder of usage: null
 * when the service has no slot for the account or did not read it.
 */
export type SealUsageFetch = (candidate: SealAccountCandidate) => Promise<ProviderRateLimits | null>

export type SealUsagePollerDeps = {
  now: () => number
  candidates: (provider: SealProvider) => SealAccountCandidate[]
  settings: (provider: SealProvider) => SealAutoSwapSettings
  /** The host selection plus every account a live session runs on. */
  inUse: (provider: SealProvider) => ReadonlySet<SealAccountKey>
  /** Whether any swap could happen at all (auto-swap or live session swapping on). */
  wanted: () => boolean
  fetch: SealUsageFetch
}

function readingsOf(
  candidate: SealAccountCandidate,
  limits: ProviderRateLimits,
  settings: SealAutoSwapSettings,
  now: number
): SealWindowReading[] {
  return relevantWindows({ ...candidate, limits }, settings, now)
}

function isPollable(candidate: SealAccountCandidate): boolean {
  return candidate.kind !== 'api-key' && candidate.launchable && !candidate.disabled
}

/**
 * Decides when each account's 5h/7d usage is read, on claude-swap's adaptive schedule: in-use accounts every
 * 3-5 minutes, every minute while a window climbs within 15 points of its line, idle candidates
 * every 5-10 minutes (all of them once a swap is near), exhausted ones every 10 minutes, and
 * backing off after failures and 429s. It holds no usage itself: every read goes through the
 * rate-limit service, and each fresh reading triggers a swap evaluation at once.
 */
export class SealUsagePoller {
  private readonly entries = new Map<SealAccountKey, Entry>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private running: Promise<void> | null = null
  private stopped = true
  private readonly polledListeners = new Set<() => void>()

  constructor(private readonly deps: SealUsagePollerDeps) {}

  /** Runs after each pass that read at least one account. */
  onPolled(listener: () => void): () => void {
    this.polledListeners.add(listener)
    return () => this.polledListeners.delete(listener)
  }

  samplesFor(key: SealAccountKey): {
    latest: SealUsageSample | null
    previous: SealUsageSample | null
  } {
    const entry = this.entries.get(key)
    return { latest: entry?.latest ?? null, previous: entry?.previous ?? null }
  }

  /** A new login makes this account's samples and backoff obsolete. */
  forget(key: SealAccountKey): void {
    for (const known of this.entries.keys()) {
      if (sealAccountKeysMatch(known, key)) {
        this.entries.delete(known)
      }
    }
  }

  nextPollAt(key: SealAccountKey): number | null {
    return this.stopped ? null : (this.entries.get(key)?.nextPollAt ?? null)
  }

  sync(): void {
    const wanted = this.deps.wanted()
    if (wanted && this.stopped) {
      this.stopped = false
      this.schedule(0)
    } else if (!wanted && !this.stopped) {
      this.stopped = true
      clearTimeout(this.timer ?? undefined)
      this.timer = null
    }
  }

  dispose(): void {
    this.stopped = true
    clearTimeout(this.timer ?? undefined)
  }

  private schedule(delayMs: number): void {
    clearTimeout(this.timer ?? undefined)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.pollDue().finally(() => {
        if (!this.stopped) {
          this.schedule(this.sleepMs())
        }
      })
    }, delayMs)
    this.timer.unref?.()
  }

  private sleepMs(): number {
    const now = this.deps.now()
    let next = now + MAX_SLEEP_MS
    for (const entry of this.entries.values()) {
      next = Math.min(next, entry.nextPollAt)
    }
    return Math.min(MAX_SLEEP_MS, Math.max(MIN_SLEEP_MS, next - now))
  }

  /** One pass: in-use accounts that are due, plus one due candidate (all when a swap is near). */
  pollDue(): Promise<void> {
    return this.running ?? this.track(this.runPass(), 'poll')
  }

  /** Keeps passes from overlapping: `running` is cleared only by the pass that still owns it. */
  private track(work: Promise<void>, what: string): Promise<void> {
    const pass = work
      .catch((error: unknown) => console.warn(`[seal-accounts] Usage ${what} failed:`, error))
      .finally(() => {
        if (this.running === pass) {
          this.running = null
        }
      })
    this.running = pass
    return pass
  }

  /** A person asked for fresh numbers: read every account now, except ones just read or rate limited. */
  refreshNow(): Promise<void> {
    if (this.stopped) {
      return Promise.resolve()
    }
    return this.track(
      (this.running ?? Promise.resolve()).then(() => this.runManualPass()),
      'refresh'
    )
  }

  private async runManualPass(): Promise<void> {
    let polled = 0
    for (const provider of SEAL_PROVIDERS) {
      const settings = this.deps.settings(provider)
      const inUse = this.deps.inUse(provider)
      for (const candidate of this.deps.candidates(provider).filter(isPollable)) {
        const entry = this.entries.get(candidate.key)
        const now = this.deps.now()
        const rateLimited = entry?.last429At != null && now < entry.nextPollAt
        if (entry && (rateLimited || now - entry.fetchedAt < MANUAL_REFRESH_FLOOR_MS)) {
          continue
        }
        await this.pollOne(candidate, settings, inUse.has(candidate.key))
        polled += 1
      }
    }
    this.notifyPolled(polled)
  }

  private notifyPolled(polled: number): void {
    if (polled > 0) {
      for (const listener of this.polledListeners) {
        listener()
      }
    }
  }

  private async runPass(): Promise<void> {
    let polled = 0
    for (const provider of SEAL_PROVIDERS) {
      polled += await this.pollProvider(provider)
    }
    this.notifyPolled(polled)
  }

  private async pollProvider(provider: SealProvider): Promise<number> {
    const now = this.deps.now()
    const settings = this.deps.settings(provider)
    const inUse = this.deps.inUse(provider)
    const pollable = this.deps.candidates(provider).filter(isPollable)
    const due = (candidate: SealAccountCandidate) =>
      now >= (this.entries.get(candidate.key)?.nextPollAt ?? 0)
    const active = pollable.filter((candidate) => inUse.has(candidate.key))
    const escalated = active.some((candidate) => {
      const latest = this.entries.get(candidate.key)?.latest
      return !latest || nearLine(latest.readings, accountLines(candidate, settings))
    })
    const idle = pollable.filter((candidate) => !inUse.has(candidate.key))
    const stale = (candidate: SealAccountCandidate) =>
      now - (this.entries.get(candidate.key)?.fetchedAt ?? 0) >= SERVE_TTL_MS
    const picked = escalated
      ? idle.filter((candidate) => due(candidate) || stale(candidate))
      : idle
          .filter(due)
          .sort(
            (a, b) =>
              (this.entries.get(a.key)?.fetchedAt ?? 0) - (this.entries.get(b.key)?.fetchedAt ?? 0)
          )
          .slice(0, 1)
    const batch = [...active.filter(due), ...picked]
    for (const candidate of batch) {
      await this.pollOne(candidate, settings, inUse.has(candidate.key))
    }
    return batch.length
  }

  private async pollOne(
    candidate: SealAccountCandidate,
    settings: SealAutoSwapSettings,
    inUse: boolean
  ): Promise<void> {
    const entry: Entry = this.entries.get(candidate.key) ?? {
      latest: null,
      previous: null,
      nextPollAt: 0,
      intervalMs: null,
      last429At: null,
      failures: 0,
      fetchedAt: 0
    }
    this.entries.set(candidate.key, entry)
    const limits = await this.deps.fetch(candidate).catch(() => null)
    const now = this.deps.now()
    entry.fetchedAt = now
    const readings = limits?.status === 'ok' ? readingsOf(candidate, limits, settings, now) : []
    if (!limits || readings.length === 0) {
      const kind = limits?.usageMetadata?.failureKind
      const rateLimited = kind === 'rate-limited'
      if (rateLimited) {
        entry.last429At = now
      }
      entry.failures += 1
      const retryAt = limits?.usageMetadata?.retryAtMs
      entry.nextPollAt =
        now +
        failureBackoffMs({
          consecutiveFailures: entry.failures,
          rateLimited,
          retryAfterMs: retryAt === undefined ? null : Math.max(0, retryAt - now)
        })
      return
    }
    const plan = planAfterFetch({
      prevIntervalMs: entry.intervalMs,
      prev: entry.latest?.readings ?? null,
      next: readings,
      inUse,
      lines: accountLines(candidate, settings),
      recent429: entry.last429At !== null && now - entry.last429At < RECENT_429_WINDOW_MS,
      now
    })
    entry.failures = 0
    // The service may serve the reading it already holds; that is not a second sample.
    if (entry.latest?.at !== limits.updatedAt) {
      entry.previous = entry.latest
      entry.latest = { at: limits.updatedAt, readings }
    }
    entry.intervalMs = plan.intervalMs
    entry.nextPollAt = plan.nextPollAt
  }
}
