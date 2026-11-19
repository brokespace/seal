import { useState } from 'react'
import { Loader2, Settings2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useTranslate } from '@/i18n/use-translate'
import type {
  Connector,
  PluginEntry
} from '../../../../shared/seal-connectors/seal-connectors-types'
import {
  AgentConfigConfirmDialog,
  type AgentConfigConfirmRequest
} from '../agent-config/AgentConfigConfirmDialog'
import { SettingsBadge } from '../settings/form-controls/SettingsFormControls'
import { SettingsGroup } from '../settings/section-layout/SettingsGroup'
import { AppliesToChip } from '../settings/seal-connectors/applies-to/AppliesToChip'
import { AppliesToEditor } from '../settings/seal-connectors/applies-to/AppliesToEditor'
import {
  useAppliesToOptions,
  type AppliesToOptions
} from '../settings/seal-connectors/applies-to/use-applies-to-options'
import { ConnectorSignInButton } from '../settings/seal-connectors/ConnectorSignInButton'
import { ConnectorStatusPill } from '../settings/seal-connectors/ConnectorStatusPill'
import {
  connectorSignInState,
  signInStateOfOwnHost,
  worstSignInState
} from '../settings/seal-connectors/seal-connector-status'
import {
  connectorsCall,
  type SealConnectors
} from '../settings/seal-connectors/use-seal-connectors'

const HARNESS_LABELS = { claude: 'Claude Code', codex: 'Codex' } as const

function PluginConnectorRow({
  connector,
  connectors,
  now
}: {
  connector: Connector
  connectors: SealConnectors
  now: number
}): React.JSX.Element {
  const state = connectorSignInState(connector, connectors.status?.signIns ?? null, now)
  const signIns = connectors.status?.signIns ?? []
  const needsRenewal = connector.signIns.find((signIn) => {
    const own = signInStateOfOwnHost(signIn, signIns, now)
    return worstSignInState([own]) !== 'connected'
  })
  return (
    <div className="flex items-center gap-2 py-1" data-plugin-connector={connector.id}>
      <span className="min-w-0 flex-1 truncate text-xs">{connector.title}</span>
      <ConnectorStatusPill state={state} />
      {connector.signIns.length === 0 || needsRenewal ? (
        <ConnectorSignInButton
          connector={connector}
          signInId={needsRenewal?.id ?? null}
          onDone={() => void connectors.refresh()}
        />
      ) : null}
    </div>
  )
}

function PluginRow({
  plugin,
  connectors,
  options,
  now,
  onRemove
}: {
  plugin: PluginEntry
  connectors: SealConnectors
  options: AppliesToOptions
  now: number
  onRemove: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const [editing, setEditing] = useState(false)
  const brought = (connectors.config?.connectors ?? []).filter(
    (connector) =>
      (connector.source.kind === 'plugin' && connector.source.pluginId === plugin.id) ||
      plugin.connectorIds.includes(connector.id)
  )
  const update = (patch: Partial<PluginEntry>): void =>
    void connectors.editConfig((config) => ({
      ...config,
      plugins: config.plugins.map((entry) =>
        entry.id === plugin.id ? { ...entry, ...patch } : entry
      )
    }))
  return (
    <div data-settings-row="" data-agent-plugin-installed={plugin.id} className="space-y-2 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="truncate text-sm font-medium">{plugin.name}</p>
          {plugin.description ? (
            <p className="line-clamp-2 text-xs text-muted-foreground">{plugin.description}</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-1.5">
            <SettingsBadge tone="muted">{HARNESS_LABELS[plugin.harness]}</SettingsBadge>
            <SettingsBadge tone="muted">{plugin.marketplace}</SettingsBadge>
            {plugin.skillNames.length > 0 ? (
              <span className="text-xs text-muted-foreground">
                {t('seal.plugins.skillCount', '{{count}} skills', {
                  count: plugin.skillNames.length
                })}
              </span>
            ) : null}
            <AppliesToChip value={plugin} options={options} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t('seal.plugins.appliesTo', 'Choose where {{name}} applies', {
              name: plugin.name
            })}
            aria-expanded={editing}
            onClick={() => setEditing((open) => !open)}
          >
            <Settings2 />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t('seal.plugins.remove', 'Remove {{name}}', { name: plugin.name })}
            onClick={onRemove}
          >
            <Trash2 />
          </Button>
          <Switch
            checked={plugin.enabled}
            aria-label={t('seal.plugins.enabled', 'Use {{name}}', { name: plugin.name })}
            onCheckedChange={(enabled) => update({ enabled })}
          />
        </div>
      </div>
      {brought.length > 0 ? (
        <div className="divide-y divide-border rounded-md border border-border px-3">
          {brought.map((connector) => (
            <PluginConnectorRow
              key={connector.id}
              connector={connector}
              connectors={connectors}
              now={now}
            />
          ))}
        </div>
      ) : null}
      {editing ? (
        <div className="rounded-md border border-border p-3">
          <AppliesToEditor value={plugin} options={options} onChange={(next) => update(next)} />
        </div>
      ) : null}
    </div>
  )
}

/** The plugins installed once for the whole fleet, with the connectors and skills each one brings. */
export function AgentPluginsInstalled({
  connectors,
  now: nowOverride
}: {
  connectors: SealConnectors
  now?: number
}): React.JSX.Element {
  const now = nowOverride ?? connectors.readAt
  const t = useTranslate()
  const options = useAppliesToOptions(connectors.fleet)
  const [confirm, setConfirm] = useState<AgentConfigConfirmRequest | null>(null)
  const plugins = connectors.config?.plugins ?? []

  const remove = (plugin: PluginEntry): void =>
    setConfirm({
      title: t('seal.plugins.removeTitle', 'Remove {{name}}?', { name: plugin.name }),
      description: t(
        'seal.plugins.removeDescription',
        'Its connectors and skills go with it, on every machine.'
      ),
      confirmLabel: t('seal.plugins.removeConfirm', 'Remove plugin'),
      destructive: true,
      run: async () => {
        await connectorsCall(
          'seal.connectors.removePlugin',
          { pluginId: plugin.id },
          { timeoutMs: 120_000 }
        )
        await connectors.refresh()
      }
    })

  return (
    <>
      <p className="px-1 text-xs text-muted-foreground">
        {t(
          'seal.plugins.installed.description',
          'Installed once for every machine and account Seal runs agents on.'
        )}
      </p>
      <SettingsGroup>
        {!connectors.config ? (
          <div data-settings-row="" className="flex h-16 items-center justify-center">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : plugins.length === 0 ? (
          <p data-settings-row="" className="py-3 text-xs text-muted-foreground">
            {t(
              'seal.plugins.installed.none',
              'No plugins installed. Browse the marketplaces to add one.'
            )}
          </p>
        ) : (
          plugins.map((plugin) => (
            <PluginRow
              key={plugin.id}
              plugin={plugin}
              connectors={connectors}
              options={options}
              now={now}
              onRemove={() => remove(plugin)}
            />
          ))
        )}
      </SettingsGroup>
      <AgentConfigConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </>
  )
}
