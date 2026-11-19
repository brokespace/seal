import { useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useTranslate } from '@/i18n/use-translate'
import type { Connector } from '../../../../../shared/seal-connectors/seal-connectors-types'
import { SETTINGS_GROUP_ROW_BLEED_CLASS, SettingsGroup } from '../section-layout/SettingsGroup'
import { AddConnectorDialog } from './AddConnectorDialog'
import { AppliesToChip } from './applies-to/AppliesToChip'
import { useAppliesToOptions } from './applies-to/use-applies-to-options'
import { ConnectorSheet } from './ConnectorSheet'
import { ConnectorSourceBadge } from './ConnectorSourceBadge'
import { ConnectorStatusPill } from './ConnectorStatusPill'
import { RefresherCard } from './RefresherCard'
import { connectorSignInState, visibleConnectors } from './seal-connector-status'
import { useSealConnectors, type SealConnectors } from './use-seal-connectors'

function ConnectorRow({
  connector,
  connectors,
  options,
  now,
  onOpen
}: {
  connector: Connector
  connectors: SealConnectors
  options: ReturnType<typeof useAppliesToOptions>
  now: number
  onOpen: () => void
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <div
      data-settings-row=""
      data-connector-row={connector.id}
      className={`flex items-center gap-3 py-2.5 hover:bg-accent/40 ${SETTINGS_GROUP_ROW_BLEED_CLASS}`}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        onClick={onOpen}
      >
        <div className="min-w-0 flex-1 space-y-1">
          <p className="truncate text-sm font-medium">{connector.title}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <ConnectorSourceBadge source={connector.source} />
            <AppliesToChip value={connector} options={options} />
          </div>
        </div>
        <ConnectorStatusPill
          state={connectorSignInState(connector, connectors.status?.signIns ?? null, now)}
        />
      </button>
      <Switch
        checked={connector.enabled}
        aria-label={t('seal.connectors.row.enabled', 'Use {{title}}', { title: connector.title })}
        onCheckedChange={(enabled) =>
          void connectors.editConfig((config) => ({
            ...config,
            connectors: config.connectors.map((entry) =>
              entry.id === connector.id ? { ...entry, enabled } : entry
            )
          }))
        }
      />
    </div>
  )
}

/** The one connector list every agent session gets, with who is signed in and where each applies. */
export function ConnectorsPageView({
  connectors,
  now: nowOverride,
  initialAdding = false,
  initialOpenId = null
}: {
  connectors: SealConnectors
  now?: number
  initialAdding?: boolean
  initialOpenId?: string | null
}): React.JSX.Element {
  const now = nowOverride ?? connectors.readAt
  const t = useTranslate()
  const options = useAppliesToOptions(connectors.fleet)
  const [adding, setAdding] = useState(initialAdding)
  const [openId, setOpenId] = useState<string | null>(initialOpenId)
  const list = visibleConnectors(connectors.config?.connectors ?? [])
  const open = list.find((connector) => connector.id === openId) ?? null

  return (
    <div className="space-y-6" data-seal-connectors="">
      <RefresherCard connectors={connectors} now={now} />
      <SettingsGroup
        title={t('seal.connectors.list.title', 'Connectors')}
        description={t(
          'seal.connectors.list.description',
          'MCP servers every agent session gets, whichever machine or account it runs on.'
        )}
        action={
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            <Plus />
            {t('seal.connectors.list.add', 'Add connector…')}
          </Button>
        }
      >
        {!connectors.config ? (
          <div data-settings-row="" className="flex h-16 items-center justify-center">
            {connectors.error ? (
              <p className="text-xs text-destructive [overflow-wrap:anywhere]" role="alert">
                {connectors.error}
              </p>
            ) : (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            )}
          </div>
        ) : list.length === 0 ? (
          <p data-settings-row="" className="py-3 text-xs text-muted-foreground">
            {t(
              'seal.connectors.list.empty',
              'No connectors yet. Add one from the catalog, or install a plugin that brings its own.'
            )}
          </p>
        ) : (
          list.map((connector) => (
            <ConnectorRow
              key={connector.id}
              connector={connector}
              connectors={connectors}
              options={options}
              now={now}
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
      {adding ? (
        <AddConnectorDialog
          connectors={connectors}
          onClose={() => setAdding(false)}
          onCreated={(id) => {
            setAdding(false)
            setOpenId(id)
          }}
        />
      ) : null}
    </div>
  )
}

export function ConnectorsPage(): React.JSX.Element {
  const t = useTranslate()
  const connectors = useSealConnectors(t('seal.connectors.error', 'Could not update connectors'))
  return <ConnectorsPageView connectors={connectors} />
}
