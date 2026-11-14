import type { CSSProperties, ReactNode, Ref } from 'react'
import { LogIn } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import { formatResetDuration } from '../../../../../shared/rate-limit-reset-format'
import type { SealQuarantineEntry } from '../../../../../shared/seal-accounts/seal-accounts-status'
import type {
  SealFleetAccount,
  SealFleetMachine
} from '../../../../../shared/seal-accounts/seal-fleet-overview'
import { Badge } from '../../ui/badge'
import { Button } from '../../ui/button'
import { SealAccountCardMenu } from './SealAccountCardMenu'
import { SealAccountMachines } from './SealAccountMachines'
import {
  hasInlineUsage,
  InlineUsageBars,
  InlineUsageSkeleton
} from '../../status-bar/InlineProviderUsage'
import {
  sealAccountIdentity,
  sealAccountNotice,
  sealHealthAdvice,
  sealHealthTone,
  sealLoginBillingBadge
} from './seal-account-presentation'

export type SealAccountCardActions = {
  onUse: () => void
  onRelogin: () => void
  onEdit: () => void
  onRemove: () => void
  onPush: (machineId: string) => void
}

type SealAccountCardProps = SealAccountCardActions & {
  account: SealFleetAccount
  /** 1-based position in its group; the lowest working account is preferred. */
  rank: number
  quarantine: SealQuarantineEntry | undefined
  now: number
  /** Machines other than this one, which a login can be pushed to. */
  pushTargets: readonly SealFleetMachine[]
  /** The drag grip; absent where the list cannot be reordered. */
  grip?: ReactNode
  rowRef?: Ref<HTMLDivElement>
  rowStyle?: CSSProperties
}

function formatClock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

const TONE_CLASS = {
  ok: 'text-muted-foreground',
  warning: 'text-status-warning-text',
  dead: 'text-destructive'
} as const

const TONE_DOT_CLASS = {
  ok: 'bg-status-success',
  warning: 'bg-status-warning',
  dead: 'bg-destructive'
} as const

/** One account: who it is, whether it works, how full it is, and where its login lives. */
export function SealAccountCard({
  account,
  rank,
  quarantine,
  now,
  pushTargets,
  grip,
  rowRef,
  rowStyle,
  onUse,
  onRelogin,
  onEdit,
  onRemove,
  onPush
}: SealAccountCardProps): React.JSX.Element {
  const t = useTranslate()
  const { candidate } = account
  const { limits } = candidate
  const tone = sealHealthTone(candidate.health)
  const notice = sealAccountNotice(candidate, now, t)
  const firstReadPending = candidate.usageFetching === true || limits?.status === 'fetching'
  const isLogin = candidate.kind !== 'api-key'
  const identity = sealAccountIdentity(candidate, t)
  const advice = sealHealthAdvice(candidate, t)
  const billingBadge = sealLoginBillingBadge(candidate, t)
  const paused = quarantine && quarantine.until > now ? quarantine : null
  const canUse =
    account.onHome && isLogin && candidate.launchable && !candidate.active && tone !== 'dead'
  const facts = [
    candidate.swapEstimate
      ? candidate.swapEstimate.at <= now
        ? t('seal.accounts.estimate.now', 'Over its {{value0}} limit; swapping', {
            value0: candidate.swapEstimate.window
          })
        : t('seal.accounts.estimate.at', 'Next swap ~{{value0}} ({{value1}} reaches {{value2}}%)', {
            value0: formatResetDuration(candidate.swapEstimate.at - now),
            value1: candidate.swapEstimate.window,
            value2: candidate.swapEstimate.line
          })
      : null,
    account.sessions > 0
      ? account.sessions === 1
        ? t('seal.accounts.card.oneSession', '1 session running')
        : t('seal.accounts.card.sessions', '{{value0}} sessions running', {
            value0: account.sessions
          })
      : t('seal.accounts.card.noSessions', 'No sessions running'),
    candidate.nextPollAt && candidate.nextPollAt > now
      ? t('seal.accounts.estimate.nextPoll', 'Usage read again in {{value0}}', {
          value0: formatResetDuration(candidate.nextPollAt - now)
        })
      : null
  ].filter(Boolean)

  return (
    <div
      ref={rowRef}
      style={rowStyle}
      className="flex gap-2 py-3"
      data-settings-row=""
      data-slot="seal-account-card"
      data-account-key={account.key}
    >
      <div className="flex w-9 shrink-0 items-start gap-0.5 pt-0.5">
        {grip}
        <span
          className="text-xs text-muted-foreground tabular-nums"
          title={t('seal.accounts.card.rankHint', 'Order of preference in this group')}
        >
          {rank}
        </span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="truncate text-sm font-medium">{candidate.label}</span>
              {candidate.plan ? (
                <Badge variant="outline" data-slot="seal-account-plan">
                  {candidate.plan}
                </Badge>
              ) : null}
              {billingBadge ? (
                <Badge variant="outline" title={billingBadge.hint} data-slot="seal-account-billing">
                  {billingBadge.label}
                </Badge>
              ) : null}
              {candidate.systemLogin ? (
                <Badge
                  variant="outline"
                  title={t(
                    'seal.accounts.badge.systemLoginHint',
                    'This is the login the CLI on this computer uses outside Seal.'
                  )}
                >
                  {t('seal.accounts.badge.systemLogin', 'System login')}
                </Badge>
              ) : null}
              {candidate.wslDistro ? (
                <Badge variant="outline">
                  {t('seal.accounts.badge.wsl', 'WSL: {{value0}}', { value0: candidate.wslDistro })}
                </Badge>
              ) : null}
              {candidate.active ? (
                <Badge variant="secondary">
                  {t('seal.accounts.badge.active', 'New sessions start here')}
                </Badge>
              ) : null}
              {candidate.disabled ? (
                <Badge variant="outline">
                  {t('seal.accounts.badge.manualOnly', 'Manual only')}
                </Badge>
              ) : null}
              {paused ? (
                <Badge variant="outline" title={paused.reason}>
                  {t('seal.accounts.badge.paused', 'Paused until {{value0}}', {
                    value0: formatClock(paused.until)
                  })}
                </Badge>
              ) : null}
            </div>
            {identity ? (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{identity}</p>
            ) : null}
          </div>
          {notice ? (
            <span
              className={cn(
                'flex shrink-0 items-center gap-1.5 pt-0.5 text-xs',
                TONE_CLASS[notice.tone]
              )}
              data-slot="seal-account-health"
              data-health={notice.state}
            >
              <span
                className={cn('size-1.5 rounded-full', TONE_DOT_CLASS[notice.tone])}
                aria-hidden
              />
              {notice.label}
            </span>
          ) : null}
          {tone === 'dead' && candidate.credential === 'login' ? (
            <Button variant="outline" size="xs" onClick={onRelogin}>
              <LogIn />
              {t('seal.accounts.action.relogin', 'Sign in again')}
            </Button>
          ) : canUse ? (
            <Button variant="outline" size="xs" onClick={onUse}>
              {t('seal.accounts.action.use', 'Use for new sessions')}
            </Button>
          ) : null}
          <SealAccountCardMenu
            account={account}
            pushTargets={pushTargets}
            onRelogin={onRelogin}
            onEdit={onEdit}
            onRemove={onRemove}
            onPush={onPush}
          />
        </div>
        {advice ? <p className={cn('text-xs', TONE_CLASS[tone])}>{advice}</p> : null}
        {candidate.kind === 'api-key' ? (
          <p className="text-xs text-muted-foreground">
            {candidate.credential === 'setup-token'
              ? t(
                  'seal.accounts.card.setupTokenUsage',
                  'Runs on your Claude subscription. Claude does not report usage for setup tokens.'
                )
              : t('seal.accounts.card.apiKeyUsage', 'Pay as you go; no plan limits to track.')}
          </p>
        ) : (
          // The usage popover's own bars over the same reading, so the two always agree.
          <div className="max-w-sm" data-slot="seal-account-usage">
            {hasInlineUsage(limits) ? (
              <InlineUsageBars limits={limits} isFetching={candidate.usageFetching === true} />
            ) : firstReadPending ? (
              <InlineUsageSkeleton />
            ) : (
              <p className="text-xs text-muted-foreground">
                {t('seal.accounts.card.noUsage', 'No usage reading yet.')}
              </p>
            )}
          </div>
        )}
        <p className="text-xs text-muted-foreground" data-slot="seal-account-facts">
          {facts.join(' · ')}
        </p>
        <SealAccountMachines account={account} />
      </div>
    </div>
  )
}
