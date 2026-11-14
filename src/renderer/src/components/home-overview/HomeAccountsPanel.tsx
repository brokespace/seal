import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import {
  ACCOUNT_NEAR_LIMIT_PERCENT,
  accountNextReset
} from '../../../../shared/home-overview/home-overview-derivations'
import type { HomeAccount } from './home-overview-model'
import { formatHomeCountdown, homeUsageWindowLabel } from './home-overview-presentation'
import { PageCard } from '@/components/page-layout/PageCard'
import { HomeOverviewEmpty, HomeOverviewRowButton } from './HomeOverviewRow'

function UsageBar({ percent }: { percent: number }): React.JSX.Element {
  const clamped = Math.max(0, Math.min(100, percent))
  return (
    <span className="relative block h-1 w-full overflow-hidden rounded-full bg-muted">
      <span
        className={cn(
          'absolute inset-y-0 left-0 rounded-full',
          clamped >= ACCOUNT_NEAR_LIMIT_PERCENT ? 'bg-destructive' : 'bg-foreground/50'
        )}
        style={{ width: `${clamped}%` }}
      />
    </span>
  )
}

function AccountRow({
  account,
  now,
  onOpen
}: {
  account: HomeAccount
  now: number
  onOpen: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const reset = accountNextReset(account, now)
  const statusText =
    account.status === 'loading'
      ? t('home.overview.accounts.loading', 'Reading usage…')
      : account.status === 'error'
        ? (account.error ?? t('home.overview.accounts.error', 'Usage unavailable'))
        : account.windows.length === 0
          ? t('home.overview.accounts.noUsage', 'No usage reported')
          : null
  return (
    <li className="p-1">
      <HomeOverviewRowButton onClick={onOpen} className="block px-2 py-1">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-xs text-foreground">{account.label}</span>
          <span className="shrink-0 text-2xs text-muted-foreground">
            {account.providerLabel}
            {account.active ? ` · ${t('home.overview.accounts.active', 'active')}` : ''}
          </span>
        </span>
        {statusText ? (
          <span className="mt-1 block truncate text-2xs text-muted-foreground">{statusText}</span>
        ) : (
          <span className="mt-1.5 grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1">
            {account.windows.map((window) => (
              <span key={window.kind} className="contents">
                <span className="text-3xs text-muted-foreground">
                  {homeUsageWindowLabel(window.kind, t)}
                </span>
                <UsageBar percent={window.usedPercent} />
                <span className="text-3xs text-muted-foreground tabular-nums">
                  {Math.round(window.usedPercent)}%
                </span>
              </span>
            ))}
          </span>
        )}
        {reset ? (
          <span className="mt-1 block text-3xs text-muted-foreground tabular-nums">
            {t('home.overview.accounts.reset', 'Resets {{when}}', {
              when: formatHomeCountdown(reset, now)
            })}
          </span>
        ) : null}
      </HomeOverviewRowButton>
    </li>
  )
}

export function HomeAccountsPanel({
  accounts,
  now,
  onManage
}: {
  accounts: readonly HomeAccount[]
  now: number
  onManage: () => void
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <PageCard
      title={t('home.overview.accounts.title', 'Accounts')}
      action={
        <Button variant="ghost" size="xs" onClick={onManage}>
          {t('home.overview.accounts.manage', 'Manage')}
        </Button>
      }
    >
      {accounts.length === 0 ? (
        <HomeOverviewEmpty>
          {t(
            'home.overview.accounts.empty',
            'No account usage yet. Sign in to an agent to track limits.'
          )}
        </HomeOverviewEmpty>
      ) : (
        <ul className="divide-y divide-border">
          {accounts.map((account) => (
            <AccountRow key={account.id} account={account} now={now} onOpen={onManage} />
          ))}
        </ul>
      )}
    </PageCard>
  )
}
