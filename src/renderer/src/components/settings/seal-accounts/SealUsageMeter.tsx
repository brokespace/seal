import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import { formatResetDuration } from '../../../../../shared/rate-limit-reset-format'
import type { SealUsageWindow } from '../../../../../shared/seal-accounts/seal-account-candidates'

type SealUsageMeterProps = {
  label: string
  window: SealUsageWindow | null
  threshold: number
  now: number
}

/** One usage window: fill, percent and reset, marked once it crosses the swap threshold. */
export function SealUsageMeter({ label, window, threshold, now }: SealUsageMeterProps) {
  const t = useTranslate()
  const expired =
    window?.resetsAt !== null && window?.resetsAt !== undefined && window.resetsAt <= now
  const used = window ? (expired ? 0 : Math.round(window.usedPercent)) : null
  const over = used !== null && used >= threshold
  const reset =
    window?.resetsAt && window.resetsAt > now ? formatResetDuration(window.resetsAt - now) : null
  return (
    <div className="flex min-w-0 items-center gap-2 text-xs" data-slot="seal-usage-meter">
      <span className="w-10 shrink-0 truncate text-muted-foreground">{label}</span>
      <div
        className="relative h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={used ?? undefined}
      >
        {used !== null ? (
          <div
            className={cn(
              'h-full rounded-full transition-[width] motion-reduce:transition-none',
              over ? 'bg-destructive' : 'bg-foreground/70'
            )}
            style={{ width: `${Math.min(100, used)}%` }}
          />
        ) : null}
        <div
          className="absolute inset-y-0 w-px bg-foreground/40"
          style={{ left: `${Math.min(100, threshold)}%` }}
        />
      </div>
      <span className={cn('w-9 shrink-0 tabular-nums', over && 'text-destructive')}>
        {used === null ? '—' : `${used}%`}
      </span>
      {reset ? (
        <span className="truncate text-muted-foreground">
          {t('seal.accounts.meter.resetsIn', 'resets in {{value0}}', { value0: reset })}
        </span>
      ) : null}
    </div>
  )
}
