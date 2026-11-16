import { hasUsageData } from '../../../../src/shared/agent-usage/display/usage-provider-windows'
import type { Translate } from '../../i18n/mobile-i18n'
import { formatTimeAgo } from '../../worktree/agent-lineage/agent-row-display'
import type { ProviderRateLimits } from '../accounts-snapshot'

export function usageUpdatedLabel(updatedAt: number, now: number, t: Translate): string {
  return now - updatedAt < 60_000
    ? t('home.usage.updatedJustNow', 'Updated just now')
    : t('home.usage.updatedAgo', 'Updated {{time}} ago', { time: formatTimeAgo(updatedAt, now) })
}

/** When the figures were read, for a failed check that left the last good ones standing. */
export function keptUsageReadAt(limits: ProviderRateLimits | null): number | null {
  return limits?.status === 'error' && hasUsageData(limits) && limits.updatedAt > 0
    ? limits.updatedAt
    : null
}
