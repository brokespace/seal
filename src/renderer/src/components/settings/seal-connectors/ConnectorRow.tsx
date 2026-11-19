import { Switch } from '@/components/ui/switch'
import { useTranslate } from '@/i18n/use-translate'
import type { Connector } from '../../../../../shared/seal-connectors/seal-connectors-types'
import { SETTINGS_GROUP_ROW_BLEED_CLASS } from '../section-layout/SettingsGroup'
import { AppliesToChip } from './applies-to/AppliesToChip'
import type { useAppliesToOptions } from './applies-to/use-applies-to-options'
import { ConnectorSourceBadge } from './ConnectorSourceBadge'
import { ConnectorStatusPill } from './ConnectorStatusPill'
import {
  connectorSignInState,
  type ConnectorSignInState,
  type SignInState
} from './seal-connector-status'
import type { SealConnectors } from './use-seal-connectors'

export function ConnectorRow({
  connector,
  connectors,
  options,
  now,
  state,
  onOpen
}: {
  connector: Connector
  connectors: SealConnectors
  options: ReturnType<typeof useAppliesToOptions>
  now: number
  /** One host's state for this connector (null: none needed); omitted, the row computes the connector's own. */
  state?: ConnectorSignInState | SignInState | null
  onOpen: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const pillState =
    state === undefined
      ? connectorSignInState(connector, connectors.status?.signIns ?? null, now)
      : (state ?? 'no-sign-in-needed')
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
        <ConnectorStatusPill state={pillState} />
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
