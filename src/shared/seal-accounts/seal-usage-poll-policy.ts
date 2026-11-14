// Adapted from claude-swap (MIT, https://github.com/realiti4/claude-swap): the cadence numbers and
// plan_after_fetch in src/claude_swap/poll_policy.py, and the failure backoff in usage_store.py.
// The usage endpoint admits roughly 28-30 requests per account per trailing hour, so the steady
// target is about one request every 3 minutes, with a bounded 60s burst near a switch line.
import {
  rawHeadroom,
  windowLine,
  type SealAccountLines,
  type SealWindowReading
} from './seal-usage-lines'

/** A reading younger than this is served without a fetch. */
export const SERVE_TTL_MS = 180_000
/** Movement can halve an interval down to this, never below. */
export const MIN_INTERVAL_MS = 180_000
/** An in-use account with a window rising inside the escalation band. */
export const URGENT_INTERVAL_MS = 60_000
export const ACTIVE_MAX_INTERVAL_MS = 300_000
export const CANDIDATE_DEFAULT_INTERVAL_MS = 300_000
export const CANDIDATE_MAX_INTERVAL_MS = 600_000
/** Exhausted accounts keep a slow poll so an early quota grant is noticed. */
export const EXHAUSTED_INTERVAL_MS = 600_000
export const MOVEMENT_DELTA_PCT = 1
export const JITTER_FRAC = 0.1
export const POST_429_MIN_INTERVAL_MS = 360_000
export const RECENT_429_WINDOW_MS = 3_600_000
export const POST_429_BACKOFF_MULT = 1.5
export const POST_429_MAX_INTERVAL_MS = 1_800_000
/** Within this many points of a line, an in-use account polls urgently and candidates refresh. */
export const ESCALATION_MARGIN_PCT = 15
/** Never schedule a poll later than a known window reset plus this slack. */
export const RESET_SLACK_MS = 60_000
export const FAILURE_BACKOFF_BASE_MS = 30_000
export const FAILURE_BACKOFF_CAP_MS = 600_000
/** claude-swap's saturated-edge wait after a 429 with no usable Retry-After. */
export const EDGE_BACKOFF_MS = 300_000

export type SealPollPlan = { nextPollAt: number; intervalMs: number }

export type SealPollFetchInput = {
  prevIntervalMs: number | null
  prev: readonly SealWindowReading[] | null
  next: readonly SealWindowReading[]
  /** The host's selected account or one a live session runs on. */
  inUse: boolean
  lines: SealAccountLines
  recent429: boolean
  now: number
  rng?: () => number
}

function bindingPct(windows: readonly SealWindowReading[] | null): number | null {
  const headroom = windows ? rawHeadroom(windows) : null
  return headroom === null ? null : 100 - headroom
}

/** Whether one window rose by real movement into the band under its own line. */
export function risingInBand(
  prev: readonly SealWindowReading[] | null,
  next: readonly SealWindowReading[],
  lines: SealAccountLines
): boolean {
  const before = new Map((prev ?? []).map((window) => [window.label, window.pct]))
  return next.some((window) => {
    const was = before.get(window.label)
    return (
      was !== undefined &&
      window.pct - was >= MOVEMENT_DELTA_PCT &&
      window.pct >= windowLine(window.label, lines) - ESCALATION_MARGIN_PCT
    )
  })
}

/** Whether any window sits within the escalation band of its line (a swap could be near). */
export function nearLine(windows: readonly SealWindowReading[], lines: SealAccountLines): boolean {
  return windows.some(
    (window) => window.pct >= windowLine(window.label, lines) - ESCALATION_MARGIN_PCT
  )
}

/** claude-swap's plan_after_fetch: when to read this account again after a good reading. */
export function planAfterFetch(input: SealPollFetchInput): SealPollPlan {
  const { inUse, now } = input
  const fallback = inUse ? MIN_INTERVAL_MS : CANDIDATE_DEFAULT_INTERVAL_MS
  const ceiling = inUse ? ACTIVE_MAX_INTERVAL_MS : CANDIDATE_MAX_INTERVAL_MS
  const base = input.prevIntervalMs ?? fallback
  const prevPct = bindingPct(input.prev)
  const nextPct = bindingPct(input.next)
  let interval: number
  if (prevPct === null || nextPct === null) {
    interval = fallback
  } else if (Math.abs(nextPct - prevPct) >= MOVEMENT_DELTA_PCT) {
    interval = Math.max(MIN_INTERVAL_MS, base / 2)
  } else {
    interval = Math.min(ceiling, Math.max(MIN_INTERVAL_MS, base * 1.5))
  }
  if (inUse && !input.recent429 && risingInBand(input.prev, input.next, input.lines)) {
    interval = URGENT_INTERVAL_MS
  }
  if (input.recent429) {
    const increased = Math.max(base * POST_429_BACKOFF_MULT, POST_429_MIN_INTERVAL_MS)
    interval = Math.min(POST_429_MAX_INTERVAL_MS, Math.max(interval, increased))
  }
  const headroom = rawHeadroom(input.next)
  const exhausted = headroom !== null && headroom <= 0
  if (exhausted) {
    interval = Math.max(interval, EXHAUSTED_INTERVAL_MS)
  }
  const rng = input.rng ?? Math.random
  let nextPollAt = now + interval * (1 + JITTER_FRAC * (2 * rng() - 1))
  const reset = exhausted ? limitingReset(input.next, now) : earliestReset(input.next, now)
  if (reset !== null) {
    nextPollAt = Math.min(nextPollAt, reset + RESET_SLACK_MS)
  }
  return { nextPollAt, intervalMs: interval }
}

function earliestReset(windows: readonly SealWindowReading[], now: number): number | null {
  let earliest: number | null = null
  for (const window of windows) {
    if (window.resetsAt !== null && window.resetsAt > now) {
      earliest = earliest === null ? window.resetsAt : Math.min(earliest, window.resetsAt)
    }
  }
  return earliest
}

/** When the last full window resets, i.e. when an exhausted account works again. */
function limitingReset(windows: readonly SealWindowReading[], now: number): number | null {
  let latest: number | null = null
  for (const window of windows) {
    if (window.pct >= 100 && window.resetsAt !== null && window.resetsAt > now) {
      latest = latest === null ? window.resetsAt : Math.max(latest, window.resetsAt)
    }
  }
  return latest
}

/** usage_store's failure backoff: 30s doubling to 10 minutes, never sooner than Retry-After. */
export function failureBackoffMs(input: {
  consecutiveFailures: number
  rateLimited: boolean
  retryAfterMs: number | null
}): number {
  const shift = Math.max(0, input.consecutiveFailures - 1)
  const computed = Math.min(
    FAILURE_BACKOFF_BASE_MS * 2 ** Math.min(shift, 32),
    FAILURE_BACKOFF_CAP_MS
  )
  if (input.retryAfterMs === null) {
    return computed
  }
  if (input.retryAfterMs === 0) {
    // Retry-After: 0 on a 429 is the saturated-budget edge; elsewhere it means "retry now".
    return input.rateLimited
      ? Math.min(Math.max(computed, EDGE_BACKOFF_MS), FAILURE_BACKOFF_CAP_MS)
      : computed
  }
  return Math.max(computed, input.retryAfterMs)
}
