// The context ring's warning points and states, read by desktop, Home chat and the phone.
import {
  formatContextTokenCount,
  type NativeChatContextUsageSummary
} from './native-chat-context-usage-summary'

/** Share of the auto-compact threshold at which the ring warns that a compaction is close. */
export const CONTEXT_NEAR_THRESHOLD_FRACTION = 0.8
/** Share of the auto-compact threshold at which the ring turns critical. */
export const CONTEXT_CRITICAL_THRESHOLD_FRACTION = 0.95
/** With no threshold known, the warning is relative to the window alone. */
export const CONTEXT_NEAR_WINDOW_PERCENTAGE = 80
/** Past this the window is nearly spent, whatever the threshold says. */
export const CONTEXT_CRITICAL_WINDOW_PERCENTAGE = 90
/** How long after a compaction the ring still says so. */
export const CONTEXT_JUST_COMPACTED_MS = 60_000

export type NativeChatContextUsageState =
  | 'unknown'
  | 'normal'
  | 'near'
  | 'critical'
  | 'compacting'
  | 'compacted'

type MeasuredContextUsage = Pick<
  NativeChatContextUsageSummary,
  'usedTokens' | 'windowTokens' | 'percentage' | 'autoCompactAtTokens' | 'lastCompactedAt'
>

export type NativeChatContextUsageClock = {
  /** A compaction is running. */
  compacting?: boolean
  now?: number
}

/** A summary with no window carries only what is known besides the size, such as compactions. */
export function isContextUsageMeasured(usage: MeasuredContextUsage | null | undefined): boolean {
  return usage !== null && usage !== undefined && usage.windowTokens > 0
}

function autoCompactThreshold(usage: MeasuredContextUsage): number | null {
  const threshold = usage.autoCompactAtTokens
  return threshold !== undefined && threshold > 0 ? threshold : null
}

function justCompacted(usage: MeasuredContextUsage, now: number): boolean {
  const at = usage.lastCompactedAt
  // A host clock slightly ahead of this one still counts.
  return at !== undefined && Math.abs(now - at) < CONTEXT_JUST_COMPACTED_MS
}

export function contextUsageState(
  usage: MeasuredContextUsage | null | undefined,
  { compacting = false, now = Date.now() }: NativeChatContextUsageClock = {}
): NativeChatContextUsageState {
  if (compacting) {
    return 'compacting'
  }
  if (!usage) {
    return 'unknown'
  }
  if (!isContextUsageMeasured(usage)) {
    return justCompacted(usage, now) ? 'compacted' : 'unknown'
  }
  const threshold = autoCompactThreshold(usage)
  if (
    usage.percentage >= CONTEXT_CRITICAL_WINDOW_PERCENTAGE ||
    (threshold !== null && usage.usedTokens >= threshold * CONTEXT_CRITICAL_THRESHOLD_FRACTION)
  ) {
    return 'critical'
  }
  if (
    threshold === null
      ? usage.percentage >= CONTEXT_NEAR_WINDOW_PERCENTAGE
      : usage.usedTokens >= threshold * CONTEXT_NEAR_THRESHOLD_FRACTION
  ) {
    return 'near'
  }
  return justCompacted(usage, now) ? 'compacted' : 'normal'
}

export type NativeChatContextUsageReadout = {
  state: NativeChatContextUsageState
  /** The arc's fill, clamped to 0-100. */
  filled: number
  /** Token counts as shown; empty while the size is not measured. */
  used: string
  window: string
  /** Where the agent compacts on its own and how far that is, when it says. */
  compactsAt?: string
  left?: string
}

/** What a ring draws and says, for every client. */
export function contextUsageRingReadout(
  usage: NativeChatContextUsageSummary | null | undefined,
  clock: NativeChatContextUsageClock = {}
): NativeChatContextUsageReadout {
  const state = contextUsageState(usage, clock)
  if (!usage || !isContextUsageMeasured(usage)) {
    return { state, filled: 0, used: '', window: '' }
  }
  const threshold = autoCompactThreshold(usage)
  return {
    state,
    filled: Math.min(Math.max(usage.percentage, 0), 100),
    used: formatContextTokenCount(usage.usedTokens),
    window: formatContextTokenCount(usage.windowTokens),
    ...(threshold === null
      ? {}
      : {
          compactsAt: formatContextTokenCount(threshold),
          left: formatContextTokenCount(Math.max(0, threshold - usage.usedTokens))
        })
  }
}

/** A session that can report usage but has none to show yet: the ring draws empty. */
export function unmeasuredContextUsage(
  compaction: Pick<NativeChatContextUsageSummary, 'compactions' | 'lastCompactedAt'> = {}
): NativeChatContextUsageSummary {
  return {
    usedTokens: 0,
    windowTokens: 0,
    percentage: 0,
    estimated: false,
    rows: [],
    ...compaction
  }
}
