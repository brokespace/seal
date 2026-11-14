import React, { useState } from 'react'
import { Input } from '@/components/ui/input'
import { useTranslate } from '@/i18n/use-translate'
import { SettingsGroup } from '../../settings/section-layout/SettingsGroup'
import { AgentConfigScopeBadge } from '../AgentConfigScopeBadge'
import { useAgentConfig } from '../model/agent-config-context'
import { agentConfigScopeLabel } from '../model/agent-config-scope-labels'

/** What the agent ends up with once every settings file is applied, and which file said so. */
export function AgentConfigEffectiveSection(): React.JSX.Element {
  const t = useTranslate()
  const { snapshot, layout } = useAgentConfig()
  const [filter, setFilter] = useState('')
  const needle = filter.trim().toLowerCase()
  const entries = snapshot.effective.filter(
    (entry) =>
      needle === '' ||
      entry.key.toLowerCase().includes(needle) ||
      entry.value.toLowerCase().includes(needle)
  )
  const order = snapshot.settings.map((layer) => agentConfigScopeLabel(layer.scope, t))

  return (
    <div className="space-y-4" data-agent-config-section="effective">
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          {order.length > 1
            ? t(
                'auto.components.agentConfig.effective.order',
                'Later files win: {{order}}. Lists are combined; secrets stay hidden.',
                { order: order.join(' → ') }
              )
            : t(
                'auto.components.agentConfig.effective.single',
                'Only the account settings apply here. Open a project’s settings to see its files merged in.'
              )}
        </p>
        <Input
          value={filter}
          placeholder={t('auto.components.agentConfig.effective.filter', 'Filter settings')}
          aria-label={t('auto.components.agentConfig.effective.filter', 'Filter settings')}
          density="compact"
          className="w-48"
          onChange={(event) => setFilter(event.target.value)}
        />
      </div>
      <SettingsGroup>
        {entries.length === 0 ? (
          <p data-settings-row="" className="py-3 text-xs text-muted-foreground">
            {snapshot.effective.length === 0
              ? t(
                  'auto.components.agentConfig.effective.empty',
                  '{{agent}} has no settings set here.',
                  { agent: layout.label }
                )
              : t('auto.components.agentConfig.effective.noMatch', 'No setting matches.')}
          </p>
        ) : (
          entries.map((entry) => (
            <div
              key={entry.key}
              data-settings-row=""
              className="space-y-1 py-2"
              data-agent-config-effective={entry.key}
            >
              <div className="flex items-start gap-2">
                <span className="w-2/5 shrink-0 font-mono text-xs [overflow-wrap:anywhere]">
                  {entry.key}
                </span>
                {entry.items ? (
                  <ul className="min-w-0 flex-1 space-y-1">
                    {entry.items.map((item) => (
                      <li key={`${item.source}:${item.value}`} className="flex items-start gap-2">
                        <span className="min-w-0 flex-1 font-mono text-xs [overflow-wrap:anywhere]">
                          {item.value}
                        </span>
                        <AgentConfigScopeBadge scope={item.source} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 font-mono text-xs [overflow-wrap:anywhere]">
                      {entry.value}
                    </span>
                    <AgentConfigScopeBadge scope={entry.source} />
                  </>
                )}
              </div>
              {entry.overrides.map((override) => (
                <p
                  key={override.source}
                  className="pl-[40%] text-xs text-muted-foreground line-through [overflow-wrap:anywhere]"
                  title={t(
                    'auto.components.agentConfig.effective.overridden',
                    'Replaced: {{scope}} had {{value}}',
                    { scope: agentConfigScopeLabel(override.source, t), value: override.value }
                  )}
                >
                  <span className="font-mono">{override.value}</span>{' '}
                  <span className="no-underline">
                    ({agentConfigScopeLabel(override.source, t)})
                  </span>
                </p>
              ))}
            </div>
          ))
        )}
      </SettingsGroup>
    </div>
  )
}
