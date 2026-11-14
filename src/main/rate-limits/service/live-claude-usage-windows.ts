import type { ClaudeStatusLineRateLimits } from '../../../shared/claude-statusline-rate-limits'
import type { ProviderRateLimits, RateLimitWindow } from '../../../shared/rate-limit-types'
import {
  isSameClaudeUsageWindow,
  isStaleClaudeUsageWindow,
  mapClaudeUsageWindow
} from '../providers/claude/claude-usage-window'
import { withoutResetWindows } from './service-result-policy'
import { LIVE_CLAUDE_INGEST_DEDUPE_MS } from './service-types'

export type LiveClaudeUsageWindows = {
  session: RateLimitWindow | null
  weekly: RateLimitWindow | null
  /** The windows this post itself reported as newer than the kept reading. */
  freshSession: RateLimitWindow | null
  freshWeekly: RateLimitWindow | null
  /** The kept reading without windows that have reset since. */
  inherited: ProviderRateLimits | null
}

/** One statusline post laid over a kept reading; null when it reports nothing newer. */
export function mergeLiveClaudeUsageWindows(
  previous: ProviderRateLimits | null,
  event: ClaudeStatusLineRateLimits,
  now: number
): LiveClaudeUsageWindows | null {
  // An idle session's older snapshot must not roll back newer account usage.
  const keepIfNewer = (
    incoming: RateLimitWindow | null,
    current: RateLimitWindow | null | undefined
  ): RateLimitWindow | null => {
    if (!incoming || isStaleClaudeUsageWindow(current, incoming, now)) {
      return null
    }
    return isSameClaudeUsageWindow(current ?? null, incoming) ? (current ?? null) : incoming
  }
  const incomingSession = mapClaudeUsageWindow(event.fiveHour ?? undefined, 300)
  const incomingWeekly = mapClaudeUsageWindow(event.sevenDay ?? undefined, 10080)
  const freshSession = keepIfNewer(incomingSession, previous?.session)
  const freshWeekly = keepIfNewer(incomingWeekly, previous?.weekly)
  if (!freshSession && !freshWeekly) {
    return null
  }
  // Kept snapshots can outlive a reset; never relabel a past-reset window as live.
  const inherited = previous ? withoutResetWindows(previous, now) : null
  // Partial statusline payloads leave unreported windows unchanged.
  const session = freshSession ?? inherited?.session ?? null
  const weekly = freshWeekly ?? inherited?.weekly ?? null
  // Stale posts that repeat the surviving window must not refresh live-feed age.
  const droppedStale = (incomingSession && !freshSession) || (incomingWeekly && !freshWeekly)
  if (
    droppedStale &&
    isSameClaudeUsageWindow(previous?.session ?? null, session) &&
    isSameClaudeUsageWindow(previous?.weekly ?? null, weekly)
  ) {
    return null
  }
  return { session, weekly, freshSession, freshWeekly, inherited }
}

/** A post that repeats the live reading already shown, inside the dedupe window. */
export function repeatsLiveClaudeReading(
  previous: ProviderRateLimits | null,
  windows: LiveClaudeUsageWindows,
  now: number
): boolean {
  return (
    previous?.status === 'ok' &&
    previous.usageMetadata?.source === 'live-session' &&
    now - previous.updatedAt < LIVE_CLAUDE_INGEST_DEDUPE_MS &&
    isSameClaudeUsageWindow(previous.session, windows.session) &&
    isSameClaudeUsageWindow(previous.weekly, windows.weekly)
  )
}

/** The reading a live post leaves for its account. */
export function liveClaudeReading(
  previous: ProviderRateLimits | null,
  windows: LiveClaudeUsageWindows,
  authProvenance: string | undefined,
  now: number
): ProviderRateLimits {
  return {
    provider: 'claude',
    session: windows.session,
    weekly: windows.weekly,
    // Statusline lacks Fable scope and credits; retain the latest OAuth values.
    fableWeekly: windows.inherited?.fableWeekly ?? null,
    extraUsage: windows.inherited?.extraUsage ?? null,
    updatedAt: now,
    error: null,
    status: 'ok',
    usageMetadata: {
      source: 'live-session',
      lastSuccessfulSource: 'live-session',
      credentialSource: previous?.usageMetadata?.credentialSource,
      retryAtMs: previous?.usageMetadata?.retryAtMs,
      authProvenance
    }
  }
}
