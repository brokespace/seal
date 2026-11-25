import { useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import { SettingsGroup } from '../section-layout/SettingsGroup'
import { AddConnectorDialog } from './AddConnectorDialog'
import { useAppliesToOptions } from './applies-to/use-applies-to-options'
import { ConnectorSheet } from './ConnectorSheet'
import { ConnectorRow } from './ConnectorRow'
import { RefresherCard } from './RefresherCard'
import { visibleConnectors } from './seal-connector-status'
import { useSealConnectors, type SealConnectors } from './use-seal-connectors'

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
