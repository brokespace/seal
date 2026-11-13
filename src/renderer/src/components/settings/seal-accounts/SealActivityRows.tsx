import { useTranslate, type Translate } from '@/i18n/use-translate'
import { Badge } from '../../ui/badge'
import type {
  SealSessionAssignment,
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

/** Recent launches with the account each one got, newest first. */
export function SealSessionRows({ sessions }: { sessions: SealSessionAssignment[] }) {
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
    <div key={session.id} className="flex items-center gap-2 py-2 text-xs" data-settings-row="">
      <Badge variant="secondary">{providerName(session.provider, t)}</Badge>
      <span className="truncate font-medium">{session.accountLabel}</span>
      <span className="truncate text-muted-foreground">
        {session.projectLabel ?? session.machineKey}
      </span>
      {session.warnings.length > 0 ? (
        <Badge variant="outline" title={session.warnings.join('\n')}>
          {t('seal.accounts.sessions.warning', 'Check policy')}
        </Badge>
      ) : null}
      <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">
        {formatTime(session.at)}
      </span>
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
