import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslate } from '@/i18n/use-translate'
import { SettingsBadge } from '../form-controls/SettingsFormControls'
import { SettingsGroup } from '../section-layout/SettingsGroup'
import { useAppliesToOptions } from './applies-to/use-applies-to-options'
import { ConnectorRow } from './ConnectorRow'
import { ConnectorSheet } from './ConnectorSheet'
import {
  connectorsForAccount,
  connectorsOnHost,
  currentRefresherLease
} from './seal-connector-status'
import { useSealConnectors, type SealConnectors } from './use-seal-connectors'

/** The connectors that reach one machine and whether its copy of each sign-in is current. */
export function MachineConnectorsSectionView({
  connectors,
  machineKeys,
  className,
  now: nowOverride,
  initialOpenId = null
}: {
  connectors: SealConnectors
  /** Ids the fleet may list this machine under (`local`, its server's environment id, its machine id). */
  machineKeys: readonly string[]
  className?: string
  now?: number
  initialOpenId?: string | null
}): React.JSX.Element {
  const now = nowOverride ?? connectors.readAt
  const t = useTranslate()
  const options = useAppliesToOptions(connectors.fleet)
  const [openId, setOpenId] = useState<string | null>(initialOpenId)
  const host = connectors.fleet?.hosts.find((entry) => machineKeys.includes(entry.target))
  const config = connectors.config
  const readable = host?.online && host.status
  const rows =
    config && host && readable
      ? connectorsOnHost(config.connectors, host, connectors.fleet, now)
      : []
  const lease = currentRefresherLease(connectors.fleet)
  const refresher = host?.status?.hostKey != null && lease?.ownerHostKey === host.status.hostKey
  const open = rows.find(({ connector }) => connector.id === openId)?.connector ?? null
  return (
    <>
      <SettingsGroup
        className={className}
        title={
          <span className="flex items-center gap-2">
            {t('seal.connectors.list.title', 'Connectors')}
            {refresher ? (
              <SettingsBadge tone="accent">
                {t('seal.connectors.here.refresher', 'Refresher')}
              </SettingsBadge>
            ) : null}
          </span>
        }
      >
        {!config ? (
          <div data-settings-row="" className="flex h-16 items-center justify-center">
            {connectors.error ? (
              <p className="text-xs text-destructive [overflow-wrap:anywhere]" role="alert">
                {connectors.error}
              </p>
            ) : (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            )}
          </div>
        ) : !readable ? (
          <p data-settings-row="" className="py-3 text-xs text-muted-foreground">
            {t('seal.connectors.here.offline', 'Seal cannot read this machine right now.')}
          </p>
        ) : rows.length === 0 ? (
          <p data-settings-row="" className="py-3 text-xs text-muted-foreground">
            {t('seal.connectors.here.none', 'No connectors reach this machine.')}
          </p>
        ) : (
          rows.map(({ connector, state }) => (
            <ConnectorRow
              key={connector.id}
              connector={connector}
              connectors={connectors}
              options={options}
              now={now}
              state={state}
              onOpen={() => setOpenId(connector.id)}
            />
          ))
        )}
      </SettingsGroup>
      <ConnectorSheet
        connector={open}
        connectors={connectors}
        options={options}
        now={now}
        onClose={() => setOpenId(null)}
      />
    </>
  )
}

export function MachineConnectorsSection({
  machineKeys,
  className
}: {
  machineKeys: readonly string[]
  className?: string
}): React.JSX.Element {
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
    <SettingsGroup title={t('seal.connectors.here.accountsTitle', 'Connectors')}>
      {accounts.map((account) => {
        const reaching = connectorsForAccount(config.connectors, account.key).filter(
          (connector) => connector.enabled
        )
        return (
          <div
            key={account.key}
            data-settings-row=""
            className="flex items-baseline gap-3 py-2.5"
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
    </SettingsGroup>
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
