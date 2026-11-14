import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import { hasInlineUsage, InlineUsageBars } from '../status-bar/InlineProviderUsage'
import type { HomeAccount } from './home-overview-model'
import { HomeOverviewEmpty, HomeOverviewPanel, HomeOverviewRowButton } from './HomeOverviewPanel'

function AccountRow({
  account,
  onOpen
}: {
  account: HomeAccount
  onOpen: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const { limits } = account
  const pending = account.fetching || limits?.status === 'fetching' || limits?.status === 'idle'
  // A reading with windows or a failed check is the popover's to describe; the rest has no bars.
  const statusText = account.needsSignIn
    ? t('seal.accounts.home.signInAgain', 'Sign in again in Settings > Accounts')
    : hasInlineUsage(limits)
      ? null
      : pending
        ? t('home.overview.accounts.loading', 'Reading usage…')
        : t('home.overview.accounts.noUsage', 'No usage reported')
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
        {statusText || !limits ? (
          <span className="mt-1 block truncate text-2xs text-muted-foreground">{statusText}</span>
        ) : (
          <span className="mt-1.5 block">
            <InlineUsageBars limits={limits} isFetching={account.fetching} />
          </span>
        )}
      </HomeOverviewRowButton>
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
    <HomeOverviewPanel
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
    </HomeOverviewPanel>
  )
}
