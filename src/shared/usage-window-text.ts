import type { ProviderRateLimits, RateLimitWindow } from './rate-limit-types'
import { formatResetDuration } from './rate-limit-reset-format'
import { clampUsedPercent } from './usage-percentage-display'
import { hasUsageData } from './usage-provider-windows'

/** One usage window for a terminal, rounded and counted down as the usage popover does: `34% (1h 58m)`. */
export function formatUsageWindowText(
  window: RateLimitWindow | null | undefined,
  now: number
): string {
  if (!window) {
    return '—'
  }
  const reset = window.resetsAt === null ? '' : ` (${formatResetDuration(window.resetsAt - now)})`
  return `${clampUsedPercent(window.usedPercent)}%${reset}`
}

/**
 * What to say beside a reading whose last check failed, or null when it needs no remark. A
 * throttled usage check is named as that: it says nothing about the account's own quota.
 */
export function usageCheckRemark(limits: ProviderRateLimits | null): string | null {
  if (limits?.status !== 'error') {
    return null
  }
  if (limits.usageMetadata?.failureKind === 'rate-limited') {
    return hasUsageData(limits)
      ? 'usage check throttled, showing the last reading'
      : 'usage check throttled'
  }
  return limits.error ? `usage: ${limits.error}` : null
}
