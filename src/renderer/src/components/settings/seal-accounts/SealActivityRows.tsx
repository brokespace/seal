import { ArrowLeftRight } from 'lucide-react'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { Badge } from '../../ui/badge'
import {
  SealSessionAccountMenu,
  swapDeliveryLabel
} from '../../seal-session/SealSessionAccountMenu'
import type {
  SealAccountsStatus,
  SealSessionAssignment,
  SealSessionLiveSwapMode,
  SealSwapEvent
} from '../../../../../shared/seal-accounts/seal-accounts-status'

const MAX_ROWS = 8

function formatTime(at: number): string {
  return new Date(at).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

function providerName(provider: string, t: Translate): string {
  return provider === 'claude'
    ? t('seal.accounts.provider.claude', 'Claude')
    : t('seal.accounts.provider.codex', 'Codex')
}

type SealSessionRowsProps = {
  sessions: SealSessionAssignment[]
  providers: SealAccountsStatus['providers']
  now: number
  onSwap: (sessionId: string, account: string) => void
  onSetLiveSwap: (sessionId: string, mode: SealSessionLiveSwapMode) => void
}

const MAX_HISTORY = 3

/** Recent launches with the account each one runs on and how it moved, newest first. */
export function SealSessionRows({
  sessions,
  providers,
  now,
  onSwap,
  onSetLiveSwap
}: SealSessionRowsProps) {
  const t = useTranslate()
  const recent = [...sessions].sort((a, b) => b.at - a.at).slice(0, MAX_ROWS)
  if (recent.length === 0) {
    return (
      <p className="py-3 text-xs text-muted-foreground" data-settings-row="">
        {t('seal.accounts.sessions.empty', 'No agent sessions launched yet.')}
      </p>
    )
  }
  return recent.map((session) => (
    <div key={session.id} className="py-2 text-xs" data-settings-row="">
      <div className="flex items-center gap-2">
        <Badge variant="secondary">{providerName(session.provider, t)}</Badge>
        {session.endedAt || !session.accountKey ? (
          <span className="truncate font-medium">{session.accountLabel}</span>
        ) : (
          <SealSessionAccountMenu
            session={session}
            candidates={providers[session.provider].candidates}
            readAt={now}
            onSwap={(account) => onSwap(session.id, account)}
            onSetLiveSwap={(mode) => onSetLiveSwap(session.id, mode)}
          />
        )}
        <span className="truncate text-muted-foreground">
          {session.projectLabel ?? session.machineKey}
        </span>
        {session.warnings.length > 0 ? (
          <Badge variant="outline" title={session.warnings.join('\n')}>
            {t('seal.accounts.sessions.warning', 'Check policy')}
          </Badge>
        ) : null}
        {session.endedAt ? (
          <Badge variant="outline">{t('seal.accounts.sessions.closed', 'Closed')}</Badge>
        ) : null}
        <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">
          {formatTime(session.at)}
        </span>
      </div>
      {(session.history ?? [])
        .slice(-MAX_HISTORY)
        .toReversed()
        .map((entry) => (
          <p
            key={`${entry.at}:${entry.to}`}
            className="mt-1 flex items-center gap-1.5 pl-2 text-2xs text-muted-foreground"
            title={entry.note}
          >
            <ArrowLeftRight className="size-3 shrink-0" aria-hidden />
            <span className="truncate">
              {t('seal.session.menu.lastSwap', '{{value0}} to {{value1}}, {{value2}}', {
                value0: entry.fromLabel,
                value1: entry.toLabel,
                value2: swapDeliveryLabel(entry, t)
              })}
            </span>
            <span className="ml-auto shrink-0 tabular-nums">{formatTime(entry.at)}</span>
          </p>
        ))}
    </div>
  ))
}

/** Recent account switches, automatic and manual, newest first. */
export function SealSwapRows({
  swaps,
  labelOf
}: {
  swaps: SealSwapEvent[]
  labelOf: (key: string) => string
}) {
  const t = useTranslate()
  const recent = [...swaps].sort((a, b) => b.at - a.at).slice(0, MAX_ROWS)
  const reasonLabel = (reason: SealSwapEvent['reason']): string => {
    switch (reason) {
      case 'manual':
        return t('seal.accounts.swap.manual', 'Manual')
      case 'auth-failure':
        return t('seal.accounts.swap.authFailure', 'Login died')
      case 'threshold':
        return t('seal.accounts.swap.threshold', 'Near limit')
      case 'rate-limit':
        return t('seal.accounts.swap.rateLimit', 'Rate limited')
      case 'not-allowed':
        return t('seal.accounts.swap.notAllowed', 'Policy change')
    }
  }
  if (recent.length === 0) {
    return (
      <p className="py-3 text-xs text-muted-foreground" data-settings-row="">
        {t('seal.accounts.swap.empty', 'No swaps yet.')}
      </p>
    )
  }
  return recent.map((swap) => (
    <div
      key={`${swap.at}:${swap.to}`}
      className="flex items-center gap-2 py-2 text-xs"
      data-settings-row=""
    >
      <Badge variant="secondary">{providerName(swap.provider, t)}</Badge>
      <span className="truncate">
        {swap.from
          ? t('seal.accounts.swap.fromTo', '{{value0}} to {{value1}}', {
              value0: labelOf(swap.from),
              value1: swap.toLabel
            })
          : swap.toLabel}
      </span>
      <Badge variant="outline">{reasonLabel(swap.reason)}</Badge>
      <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">
        {formatTime(swap.at)}
      </span>
    </div>
  ))
}
