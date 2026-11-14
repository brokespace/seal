import { useEffect, useState } from 'react'
import { formatUiNarrowDuration, formatUiNarrowRelativeTime } from '@/i18n/relative-time-format'
import type { Translate } from '@/i18n/use-translate'
import { installWindowVisibilityInterval } from '@/lib/window-activity/window-visibility-interval'
import { homeElapsed } from './home-overview-derivations'
import type { HomeMachineStatus, HomeUsageWindowKind } from './home-overview-model'

export function homeMachineStatusLabel(status: HomeMachineStatus, t: Translate): string {
  switch (status) {
    case 'online':
      return t('home.overview.machine.online', 'Online')
    case 'connecting':
      return t('home.overview.machine.connecting', 'Connecting')
    case 'offline':
      return t('home.overview.machine.offline', 'Offline')
    case 'error':
      return t('home.overview.machine.error', 'Connection failed')
  }
}

export function homeUsageWindowLabel(kind: HomeUsageWindowKind, t: Translate): string {
  switch (kind) {
    case 'session':
      return t('home.overview.usage.session', '5h')
    case 'weekly':
      return t('home.overview.usage.weekly', 'Week')
    case 'monthly':
      return t('home.overview.usage.monthly', 'Month')
  }
}

/** "12m" style duration since `fromMs`, or null when unknown. */
export function formatHomeDuration(fromMs: number, nowMs: number): string | null {
  const elapsed = homeElapsed(fromMs, nowMs)
  return elapsed ? formatUiNarrowDuration(elapsed.value, elapsed.unit) : null
}

/** "in 2h" style countdown to `atMs`. */
export function formatHomeCountdown(atMs: number, nowMs: number): string {
  const elapsed = homeElapsed(nowMs, atMs) ?? { value: 0, unit: 'minute' as const }
  return formatUiNarrowRelativeTime(elapsed.value, elapsed.unit)
}

/** Wall clock for elapsed labels; ticks only while the window is visible. */
export function useHomeNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(
    () => installWindowVisibilityInterval({ run: () => setNow(Date.now()), intervalMs }),
    [intervalMs]
  )
  return now
}
