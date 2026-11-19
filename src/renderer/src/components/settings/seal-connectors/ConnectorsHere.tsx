import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'
import { SettingsBadge } from '../form-controls/SettingsFormControls'
import { ConnectorStatusPill } from './ConnectorStatusPill'
import {
  connectorsForAccount,
  connectorsOnHost,
  currentRefresherLease
} from './seal-connector-status'
import { useSealConnectors, type SealConnectors } from './use-seal-connectors'

function Section({
  title,
  badge,
  className,
  children
}: {
  title: string
  badge?: React.ReactNode
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className={cn('space-y-2', className)} data-connectors-here="">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {badge}
      </div>
      <div className="divide-y divide-border rounded-lg border border-border px-3">{children}</div>
    </section>
  )
}

/** Read-only: the connectors that reach one machine and whether its copy of each sign-in is current. */
export function MachineConnectorsSectionView({
  connectors,
  machineKeys,
  className,
  now: nowOverride
}: {
  connectors: SealConnectors
  /** Ids the fleet may list this machine under (`local`, its server's environment id, its machine id). */
  machineKeys: readonly string[]
  className?: string
  now?: number
}): React.JSX.Element | null {
  const now = nowOverride ?? connectors.readAt
  const t = useTranslate()
  const host = connectors.fleet?.hosts.find((entry) => machineKeys.includes(entry.target))
  const config = connectors.config
  if (!host || !config) {
    return null
  }
  const rows = connectorsOnHost(config.connectors, host, connectors.fleet, now)
  const lease = currentRefresherLease(connectors.fleet)
  const refresher = host.status?.hostKey != null && lease?.ownerHostKey === host.status.hostKey
  if (rows.length === 0 && !refresher) {
    return null
  }
  return (
    <Section
      title={t('seal.connectors.here.title', 'Connectors here')}
      className={className}
      badge={
        refresher ? (
          <SettingsBadge tone="accent">
            {t('seal.connectors.here.refresher', 'Refresher')}
          </SettingsBadge>
        ) : null
      }
    >
      {!host.online || !host.status ? (
        <p className="py-2.5 text-xs text-muted-foreground">
          {t('seal.connectors.here.offline', 'Seal cannot read this machine right now.')}
        </p>
      ) : rows.length === 0 ? (
        <p className="py-2.5 text-xs text-muted-foreground">
          {t('seal.connectors.here.none', 'No connectors reach this machine.')}
        </p>
      ) : (
        rows.map(({ connector, state }) => (
          <div
            key={connector.id}
            className="flex items-center gap-2 py-2"
            data-connector-here={connector.id}
          >
            <span className="min-w-0 flex-1 truncate text-sm">{connector.title}</span>
            {!connector.enabled ? (
              <SettingsBadge tone="muted">{t('seal.connectors.here.off', 'Off')}</SettingsBadge>
            ) : null}
            <ConnectorStatusPill state={state ?? 'no-sign-in-needed'} />
          </div>
        ))
      )}
    </Section>
  )
}

export function MachineConnectorsSection({
  machineKeys,
  className
}: {
  machineKeys: readonly string[]
  className?: string
}): React.JSX.Element | null {
  const connectors = useSealConnectors()
  return (
    <MachineConnectorsSectionView
      connectors={connectors}
      machineKeys={machineKeys}
      className={className}
    />
  )
}

/** Read-only: which connectors each account gets. */
export function AccountConnectorsSectionView({
  connectors,
  accounts
}: {
  connectors: SealConnectors
  accounts: readonly { key: string; label: string }[]
}): React.JSX.Element | null {
  const t = useTranslate()
  const config = connectors.config
  if (!config || config.connectors.length === 0 || accounts.length === 0) {
    return null
  }
  return (
    <Section title={t('seal.connectors.here.accountsTitle', 'Connectors')}>
      {accounts.map((account) => {
        const reaching = connectorsForAccount(config.connectors, account.key).filter(
          (connector) => connector.enabled
        )
        return (
          <div
            key={account.key}
            className="flex items-baseline gap-3 py-2"
            data-account-connectors={account.key}
          >
            <span className="w-40 shrink-0 truncate text-sm">{account.label}</span>
            <span className="min-w-0 flex-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">
              {reaching.length > 0
                ? reaching.map((connector) => connector.title).join(' · ')
                : t('seal.connectors.here.noneForAccount', 'None')}
            </span>
          </div>
        )
      })}
    </Section>
  )
}

export function AccountConnectorsSection({
  accounts
}: {
  accounts: readonly { key: string; label: string }[]
}): React.JSX.Element | null {
  const connectors = useSealConnectors()
  return <AccountConnectorsSectionView connectors={connectors} accounts={accounts} />
}
