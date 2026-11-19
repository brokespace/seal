import React, { useEffect, useMemo, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import type {
  AgentPluginCatalog,
  AgentPluginCatalogEntry,
  AgentPluginComponents,
  AgentPluginHarness
} from '../../../../shared/agent-plugins/agent-plugin-types'
import type { MachineId } from '../../../../shared/machines/machine-types'
import { agentConfigApi, agentConfigErrorText } from '../agent-config/model/agent-config-client'
import { SettingsBadge } from '../settings/form-controls/SettingsFormControls'
import { SettingsGroup } from '../settings/section-layout/SettingsGroup'

/** The list is thousands long; a search narrows it before more are drawn. */
const SHOWN = 60

const HARNESS_LABELS: Record<AgentPluginHarness, string> = { claude: 'Claude Code', codex: 'Codex' }

function contents(components: AgentPluginComponents | null, t: Translate): string {
  if (!components) {
    return ''
  }
  return [
    components.mcpServers.length > 0
      ? t('seal.agentPlugins.browse.mcp', '{{count}} MCP servers', {
          count: components.mcpServers.length
        })
      : '',
    components.skills.length > 0
      ? t('seal.agentPlugins.browse.skills', '{{count}} skills', {
          count: components.skills.length
        })
      : '',
    components.commands.length > 0
      ? t('seal.agentPlugins.browse.commands', '{{count}} commands', {
          count: components.commands.length
        })
      : '',
    components.agents.length > 0
      ? t('seal.agentPlugins.browse.agents', '{{count}} subagents', {
          count: components.agents.length
        })
      : '',
    components.hooks.length > 0 ? t('seal.agentPlugins.browse.hooks', 'hooks') : '',
    components.lspServers.length > 0 ? t('seal.agentPlugins.browse.lsp', 'LSP servers') : ''
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Every plugin the machine's agents offer in their own marketplaces, one row per name. */
export function AgentPluginsBrowse({
  machineId,
  installed,
  onInstall
}: {
  machineId: MachineId
  /** Plugin names already in the hub on some machine. */
  installed: ReadonlySet<string>
  onInstall: (entry: AgentPluginCatalogEntry) => void
}): React.JSX.Element {
  const t = useTranslate()
  const [catalog, setCatalog] = useState<AgentPluginCatalog | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    let current = true
    setLoading(true)
    setError(null)
    agentConfigApi()
      .agentPluginCatalog({ machineId })
      .then(
        (value) => current && setCatalog(value),
        (failure: unknown) => current && setError(agentConfigErrorText(failure))
      )
      .finally(() => current && setLoading(false))
    return () => {
      current = false
    }
  }, [machineId, generation])

  const matches = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return (catalog?.entries ?? []).filter((entry) => {
      const text =
        `${entry.name} ${entry.description} ${entry.listings.map((l) => l.marketplace).join(' ')}`.toLowerCase()
      return words.every((word) => text.includes(word))
    })
  }, [catalog, query])

  return (
    <div className="space-y-4" data-agent-plugins-browse="">
      <div className="flex items-center gap-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('seal.agentPlugins.browse.search', 'Search plugins')}
          aria-label={t('seal.agentPlugins.browse.search', 'Search plugins')}
          className="flex-1"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('seal.agentPlugins.browse.reload', 'Read the marketplaces again')}
          disabled={loading}
          onClick={() => setGeneration((value) => value + 1)}
        >
          {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
        </Button>
      </div>
      {error ? (
        <p className="text-xs text-destructive [overflow-wrap:anywhere]" role="alert">
          {error}
        </p>
      ) : null}
      {catalog?.harnesses
        .filter((harness) => !harness.available)
        .map((harness) => (
          <p
            key={harness.harness}
            className="text-xs text-muted-foreground [overflow-wrap:anywhere]"
          >
            {t(
              'seal.agentPlugins.browse.harnessMissing',
              '{{agent}}’s marketplaces could not be read here: {{reason}}',
              { agent: HARNESS_LABELS[harness.harness], reason: harness.error ?? '' }
            )}
          </p>
        ))}
      <SettingsGroup
        title={t('seal.agentPlugins.browse.title', 'Marketplaces')}
        description={
          catalog
            ? t('seal.agentPlugins.browse.count', '{{shown}} of {{total}} plugins', {
                shown: Math.min(SHOWN, matches.length),
                total: matches.length
              })
            : undefined
        }
      >
        {!catalog && loading ? (
          <div data-settings-row="" className="flex h-16 items-center justify-center">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : matches.length === 0 ? (
          <p data-settings-row="" className="py-3 text-xs text-muted-foreground">
            {t('seal.agentPlugins.browse.none', 'No plugins match.')}
          </p>
        ) : (
          matches.slice(0, SHOWN).map((entry) => (
            <div
              key={entry.name}
              data-settings-row=""
              className="flex items-start gap-3 py-2.5"
              data-agent-plugin-entry={entry.name}
            >
              <div className="min-w-0 flex-1 space-y-1">
                <p className="truncate text-sm font-medium">{entry.name}</p>
                {entry.description ? (
                  <p className="line-clamp-2 text-xs text-muted-foreground">{entry.description}</p>
                ) : null}
                <div className="flex flex-wrap items-center gap-1">
                  {entry.listings.map((listing) => (
                    <SettingsBadge key={`${listing.harness}:${listing.id}`} tone="muted">
                      {HARNESS_LABELS[listing.harness]} · {listing.marketplace}
                    </SettingsBadge>
                  ))}
                  <span className="text-xs text-muted-foreground">
                    {contents(entry.components, t)}
                  </span>
                </div>
              </div>
              {installed.has(entry.name) ? (
                <SettingsBadge>
                  {t('seal.agentPlugins.browse.installed', 'Installed')}
                </SettingsBadge>
              ) : (
                <Button type="button" variant="outline" size="sm" onClick={() => onInstall(entry)}>
                  {t('seal.agentPlugins.browse.install', 'Install…')}
                </Button>
              )}
            </div>
          ))
        )}
      </SettingsGroup>
    </div>
  )
}
