import React from 'react'
import { Download, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import type {
  AgentConfigMarketplace,
  AgentConfigPluginCommand,
  AgentConfigScope
} from '../../../../../shared/agent-config/agent-config-types'
import type { AgentConfigConfirmRequest } from '../AgentConfigConfirmDialog'
import { useAgentConfig } from '../model/agent-config-context'
import { agentConfigScopeLabel } from '../model/agent-config-scope-labels'

export function AgentConfigMarketplaces({
  marketplaces,
  installScope,
  running,
  run,
  confirm
}: {
  marketplaces: readonly AgentConfigMarketplace[]
  installScope: AgentConfigScope
  /** Key of the command in flight; one runs at a time. */
  running: string | null
  run: (command: AgentConfigPluginCommand, key: string) => Promise<void>
  confirm: (request: AgentConfigConfirmRequest) => void
}): React.JSX.Element {
  const t = useTranslate()
  const { machine } = useAgentConfig()
  if (marketplaces.length === 0) {
    return (
      <p data-settings-row="" className="py-3 text-xs text-muted-foreground">
        {t('auto.components.agentConfig.plugins.noMarketplaces', 'No marketplaces added.')}
      </p>
    )
  }
  return (
    <>
      {marketplaces.map((marketplace) => {
        const key = `@marketplace:${marketplace.name}`
        const available = marketplace.plugins.filter((plugin) => !plugin.installed)
        return (
          <div
            key={marketplace.name}
            data-settings-row=""
            className="space-y-2 py-2.5"
            data-agent-config-marketplace={marketplace.name}
          >
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{marketplace.name}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {marketplace.source}
                </p>
                {marketplace.error ? (
                  <p className="text-xs text-destructive">{marketplace.error}</p>
                ) : null}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={running !== null}
                onClick={() =>
                  void run({ kind: 'marketplace-update', name: marketplace.name }, key)
                }
              >
                {running === key ? <Loader2 className="animate-spin" /> : null}
                {t('auto.components.agentConfig.plugins.refresh', 'Update')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={running !== null}
                onClick={() =>
                  confirm({
                    title: t(
                      'auto.components.agentConfig.plugins.removeMarketplaceTitle',
                      'Remove {{name}}?',
                      { name: marketplace.name }
                    ),
                    description: t(
                      'auto.components.agentConfig.plugins.removeMarketplaceDescription',
                      'Runs “claude plugin marketplace remove {{name}}” on {{machine}}.',
                      { name: marketplace.name, machine: machine.label }
                    ),
                    confirmLabel: t('auto.components.agentConfig.plugins.remove', 'Remove'),
                    destructive: true,
                    run: () => run({ kind: 'marketplace-remove', name: marketplace.name }, key)
                  })
                }
              >
                {t('auto.components.agentConfig.plugins.remove', 'Remove')}
              </Button>
            </div>
            {available.length > 0 ? (
              <ul className="space-y-1 border-l border-border pl-3">
                {available.map((plugin) => {
                  const id = `${plugin.name}@${marketplace.name}`
                  return (
                    <li key={plugin.name} className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <span className="text-xs font-medium">{plugin.name}</span>
                        {plugin.description ? (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {plugin.description}
                          </span>
                        ) : null}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        disabled={running !== null}
                        data-agent-config-install={id}
                        onClick={() =>
                          void run({ kind: 'install', plugin: id, scope: installScope }, id)
                        }
                      >
                        {running === id ? <Loader2 className="animate-spin" /> : <Download />}
                        {t('auto.components.agentConfig.plugins.install', 'Install ({{scope}})', {
                          scope: agentConfigScopeLabel(installScope, t)
                        })}
                      </Button>
                    </li>
                  )
                })}
              </ul>
            ) : null}
          </div>
        )
      })}
    </>
  )
}
