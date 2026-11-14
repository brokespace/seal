import React from 'react'
import { useTranslate } from '@/i18n/use-translate'
import type { ProviderRateLimits } from '../../../../shared/rate-limit-types'
import { hasUsageData } from '../../../../shared/usage-provider-windows'
import { hasInlineUsage, InlineUsageBars, InlineUsageSkeleton } from './InlineProviderUsage'
import { formatTimeAgo } from './tooltip'

type Reading = ProviderRateLimits | null | undefined

function isFirstRead(limits: Reading, fetching: boolean): boolean {
  return fetching || limits?.status === 'fetching' || limits?.status === 'idle'
}

/** Whether an account has figures, a failed check to name, or a first read under way. */
export function hasAccountUsageReading(limits: Reading, fetching: boolean): boolean {
  return hasInlineUsage(limits) || isFirstRead(limits, fetching)
}

/**
 * One account's usage, drawn the same wherever accounts are listed: the usage popover's bars,
 * the age of the figures when a failed check left the last good ones standing, a skeleton
 * during a first read, and one line when the account has no reading at all.
 */
export function AccountUsageReading({
  limits,
  fetching
}: {
  limits: Reading
  fetching: boolean
}): React.JSX.Element {
  const t = useTranslate()
  if (!hasInlineUsage(limits)) {
    return isFirstRead(limits, fetching) ? (
      <InlineUsageSkeleton />
    ) : (
      <span className="block text-2xs text-muted-foreground">
        {t('seal.accounts.card.noUsage', 'No usage reading yet.')}
      </span>
    )
  }
  const keptSince =
    limits.status === 'error' && hasUsageData(limits) && limits.updatedAt > 0
      ? limits.updatedAt
      : null
  return (
    <span className="grid w-full gap-1" data-slot="account-usage-reading">
      <InlineUsageBars limits={limits} isFetching={fetching} />
      {keptSince !== null ? (
        <span className="text-3xs text-muted-foreground" data-slot="account-usage-read-at">
          {t('auto.components.status.bar.tooltip.updatedAgo', 'Updated {{time}}', {
            time: formatTimeAgo(keptSince, t)
          })}
        </span>
      ) : null}
    </span>
  )
}

/** A menu row's usage column: nothing at all for an account without a reading, so the row stays narrow. */
export function accountUsage(limits: Reading, fetching: boolean): React.JSX.Element | null {
  return hasAccountUsageReading(limits, fetching) ? (
    <AccountUsageReading limits={limits} fetching={fetching} />
  ) : null
}
