import { ArrowLeftRight } from 'lucide-react'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import { formatResetDuration } from '../../../../shared/rate-limit-reset-format'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '../ui/dropdown-menu'
import type { SealAccountCandidate } from '../../../../shared/seal-accounts/seal-account-candidates'
import type {
  SealSessionAssignment,
  SealSessionLiveSwapMode,
  SealSessionSwapEntry
} from '../../../../shared/seal-accounts/seal-accounts-status'
import { sessionSwapTargets, windowUsedPercent } from './seal-session-account-view'

type SealSessionAccountMenuProps = {
  session: SealSessionAssignment
  candidates: SealAccountCandidate[]
  readAt: number
  onSwap: (accountKey: string) => void
  onSetLiveSwap: (mode: SealSessionLiveSwapMode) => void
  className?: string
  defaultOpen?: boolean
}

const LIVE_SWAP_MODES: SealSessionLiveSwapMode[] = ['inherit', 'on', 'off']

function isLiveSwapMode(value: string): value is SealSessionLiveSwapMode {
  return value === 'inherit' || value === 'on' || value === 'off'
}

function liveSwapLabel(mode: SealSessionLiveSwapMode, t: Translate): string {
  switch (mode) {
    case 'inherit':
      return t('seal.session.liveSwap.inherit', 'Follow the global setting')
    case 'on':
      return t('seal.session.liveSwap.on', 'Always move this session')
    case 'off':
      return t('seal.session.liveSwap.off', 'Never move this session')
  }
}

export function swapDeliveryLabel(entry: SealSessionSwapEntry, t: Translate): string {
  switch (entry.delivery) {
    case 'live':
      return t('seal.session.delivery.live', 'switched live')
    case 'resume':
      return t('seal.session.delivery.resume', 'resumed')
    case 'failed':
      return t('seal.session.delivery.failed', 'failed')
  }
}

/** Badge with the session's account and usage; opens a menu to move the session to another login. */
export function SealSessionAccountMenu({
  session,
  candidates,
  readAt,
  onSwap,
  onSetLiveSwap,
  className,
  defaultOpen
}: SealSessionAccountMenuProps) {
  const t = useTranslate()
  const current = candidates.find((candidate) => candidate.key === session.accountKey) ?? null
  const used = windowUsedPercent(current?.usage?.session ?? null, readAt)
  const weekly = windowUsedPercent(current?.usage?.weekly ?? null, readAt)
  const estimate = current?.swapEstimate ?? null
  const targets = sessionSwapTargets(session, candidates)
  const last = session.history?.at(-1) ?? null
  const label = current?.label ?? session.accountLabel
  return (
    <DropdownMenu modal={false} defaultOpen={defaultOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-seal-session-badge=""
          className={cn(
            'inline-flex max-w-32 shrink-0 items-center gap-1 rounded-sm border border-border px-1 text-3xs leading-4 text-muted-foreground hover:bg-muted hover:text-foreground',
            className
          )}
          title={t('seal.session.badge.title', 'Running on {{value0}}. Click to switch.', {
            value0: label
          })}
          aria-label={t('seal.session.badge.aria', 'Session account {{value0}}', {
            value0: label
          })}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <span className="truncate">{label}</span>
          {used !== null ? <span className="tabular-nums">{used}%</span> : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <p className="px-2 pt-1.5 text-2xs text-muted-foreground tabular-nums">
          {[
            used !== null
              ? t('seal.session.menu.usage5h', '5h {{value0}}%', { value0: used })
              : null,
            weekly !== null
              ? t('seal.session.menu.usage7d', '7d {{value0}}%', { value0: weekly })
              : null,
            estimate
              ? estimate.at <= readAt
                ? t('seal.session.menu.swapNow', 'swapping now')
                : t('seal.session.menu.swapAt', 'next swap ~{{value0}}', {
                    value0: formatResetDuration(estimate.at - readAt)
                  })
              : current?.nextPollAt
                ? t('seal.session.menu.noSwap', 'no swap expected before reset')
                : null
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <DropdownMenuLabel>
          {t('seal.session.menu.switch', 'Move this session to')}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={session.accountKey ?? ''}
          onValueChange={(key) => {
            if (key !== session.accountKey) {
              onSwap(key)
            }
          }}
        >
          {targets.map((candidate) => {
            const percent = windowUsedPercent(candidate.usage?.session ?? null, readAt)
            return (
              <DropdownMenuRadioItem key={candidate.key} value={candidate.key}>
                <span className="truncate">{candidate.label}</span>
                {percent !== null ? (
                  <span className="ml-auto pl-3 text-muted-foreground tabular-nums">
                    {percent}%
                  </span>
                ) : null}
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>
          {t('seal.session.menu.liveSwap', 'When this account runs low')}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={session.liveSwap ?? 'inherit'}
          onValueChange={(mode) => {
            if (isLiveSwapMode(mode)) {
              onSetLiveSwap(mode)
            }
          }}
        >
          {LIVE_SWAP_MODES.map((mode) => (
            <DropdownMenuRadioItem key={mode} value={mode}>
              {liveSwapLabel(mode, t)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {last ? (
          <>
            <DropdownMenuSeparator />
            <p className="flex items-center gap-1.5 px-2 py-1 text-2xs text-muted-foreground">
              <ArrowLeftRight className="size-3 shrink-0" aria-hidden />
              <span className="truncate">
                {t('seal.session.menu.lastSwap', '{{value0}} to {{value1}}, {{value2}}', {
                  value0: last.fromLabel,
                  value1: last.toLabel,
                  value2: swapDeliveryLabel(last, t)
                })}
              </span>
            </p>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
