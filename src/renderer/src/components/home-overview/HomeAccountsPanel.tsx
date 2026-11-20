import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import { AccountUsageReading } from '../status-bar/AccountUsageReading'
import type { HomeAccount } from './home-overview-model'
import { cn } from '@/lib/class-names'
import { SEAL_HEALTH_TEXT_CLASS } from '../settings/seal-accounts/seal-account-presentation'
import { SealSignInButton } from '../settings/seal-accounts/SealSignInButton'
import { PageCard } from '@/components/page-layout/PageCard'
import { HomeOverviewEmpty, HomeOverviewRowButton } from './HomeOverviewRow'

function AccountRow({
  account,
  onOpen
}: {
  account: HomeAccount
  onOpen: () => void
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <li className="flex items-center gap-1 p-1">
      <HomeOverviewRowButton onClick={onOpen} className="block min-w-0 flex-1 px-2 py-1">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-xs text-foreground">{account.label}</span>
          <span className="shrink-0 text-2xs text-muted-foreground">
            {account.providerLabel}
            {account.active ? ` · ${t('home.overview.accounts.active', 'active')}` : ''}
          </span>
        </span>
        {account.needsSignIn ? (
          <span className={cn('mt-1 block truncate text-2xs', SEAL_HEALTH_TEXT_CLASS.dead)}>
            {account.signInReason === 'expired'
              ? t('seal.accounts.health.loginExpired', 'Session expired')
              : t('seal.accounts.health.signInNeeded', 'Sign-in needed')}
          </span>
        ) : (
          <span className="mt-1.5 block">
            <AccountUsageReading limits={account.limits} fetching={account.fetching} />
          </span>
        )}
      </HomeOverviewRowButton>
      {account.needsSignIn && account.accountKey ? (
        <SealSignInButton accountKey={account.accountKey} />
      ) : null}
    </li>
  )
}

export function HomeAccountsPanel({
  accounts,
  onManage
}: {
  accounts: readonly HomeAccount[]
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
            <AccountRow key={account.id} account={account} onOpen={onManage} />
          ))}
        </ul>
      )}
    </PageCard>
  )
}
