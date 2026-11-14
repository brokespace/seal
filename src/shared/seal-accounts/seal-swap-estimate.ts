import {
  SESSION_WINDOW_LABEL,
  windowLine,
  type SealAccountLines,
  type SealWindowReading
} from './seal-usage-lines'

export type SealUsageSample = { at: number; readings: SealWindowReading[] }

export type SealSwapEstimate = {
  /** When the account is expected to cross a line; `now` once it already has. */
  at: number
  /** The window expected to cross first, e.g. `5h`, `7d` or a model name. */
  window: string
  line: number
}

const SESSION_PERIOD_MS = 5 * 60 * 60_000
const WEEKLY_PERIOD_MS = 7 * 24 * 60 * 60_000
/** Too early in a window, the average burn is noise. */
const MIN_ELAPSED_MS = 10 * 60_000

function burnPerMs(
  reading: SealWindowReading,
  previous: SealWindowReading | undefined,
  elapsedSincePrevious: number,
  now: number
): number | null {
  if (previous && elapsedSincePrevious > 0 && reading.pct > previous.pct) {
    return (reading.pct - previous.pct) / elapsedSincePrevious
  }
  if (reading.resetsAt === null || reading.pct <= 0) {
    return null
  }
  const period = reading.label === SESSION_WINDOW_LABEL ? SESSION_PERIOD_MS : WEEKLY_PERIOD_MS
  const elapsed = period - (reading.resetsAt - now)
  return elapsed >= MIN_ELAPSED_MS ? reading.pct / elapsed : null
}

/**
 * When an account in use is expected to reach a switch line: the recent climb between the last
 * two readings, else the window's average burn so far. Null when no window crosses before it resets.
 */
export function estimateSwap(
  latest: SealUsageSample | null,
  previous: SealUsageSample | null,
  lines: SealAccountLines,
  now: number
): SealSwapEstimate | null {
  if (!latest) {
    return null
  }
  let best: SealSwapEstimate | null = null
  for (const reading of latest.readings) {
    const line = windowLine(reading.label, lines)
    if (reading.pct >= line) {
      return { at: now, window: reading.label, line }
    }
    const before = previous?.readings.find((entry) => entry.label === reading.label)
    const rate = burnPerMs(reading, before, latest.at - (previous?.at ?? latest.at), latest.at)
    if (!rate) {
      continue
    }
    const at = latest.at + (line - reading.pct) / rate
    if (reading.resetsAt !== null && at >= reading.resetsAt) {
      continue
    }
    if (!best || at < best.at) {
      best = { at: Math.max(now, at), window: reading.label, line }
    }
  }
  return best
}
