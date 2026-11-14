import React, { useState } from 'react'
import { EllipsisVertical, Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import type {
  AgentConfigCommandResult,
  AgentConfigPlugin,
  AgentConfigPluginCommand,
  AgentConfigScope
} from '../../../../../shared/agent-config/agent-config-types'
import {
  MachinePromptDialog,
  type MachinePromptRequest
} from '../../machines/explorer/MachinePromptDialog'
import { SettingsSegmentedControl } from '../../settings/form-controls/SettingsFormControls'
import { SettingsGroup } from '../../settings/section-layout/SettingsGroup'
import {
  AgentConfigConfirmDialog,
  type AgentConfigConfirmRequest
} from '../AgentConfigConfirmDialog'
import { agentConfigApi, agentConfigErrorText } from '../model/agent-config-client'
import { useAgentConfig } from '../model/agent-config-context'
import { agentConfigScopeHint, agentConfigScopeLabel } from '../model/agent-config-scope-labels'
import { AgentConfigMarketplaces } from './AgentConfigMarketplaces'

export function AgentConfigPluginsSection(): React.JSX.Element | null {
  const t = useTranslate()
  const { snapshot, target, homeScope, machine, apply, reload } = useAgentConfig()
  const [writeScope, setWriteScope] = useState<AgentConfigScope>(
    homeScope === 'user' ? 'user' : 'local'
  )
  const [running, setRunning] = useState<string | null>(null)
  const [lastRun, setLastRun] = useState<AgentConfigCommandResult | null>(null)
  const [confirm, setConfirm] = useState<AgentConfigConfirmRequest | null>(null)
  const [prompt, setPrompt] = useState<MachinePromptRequest | null>(null)
  const plugins = snapshot.plugins
  if (!plugins) {
    return null
  }

  /** Installs, updates and removals are the machine's own `claude plugin` doing the work. */
  const run = async (command: AgentConfigPluginCommand, key: string): Promise<void> => {
    setRunning(key)
    try {
      setLastRun(await agentConfigApi().runPluginCommand({ target, command }))
    } catch (failure) {
      setLastRun({ ok: false, command: '', output: agentConfigErrorText(failure) })
    }
    setRunning(null)
    reload()
  }

  const uninstall = (plugin: AgentConfigPlugin, scope: AgentConfigScope): void =>
    setConfirm({
      title: t('auto.components.agentConfig.plugins.uninstallTitle', 'Uninstall {{name}}?', {
        name: plugin.name
      }),
      description: t(
        'auto.components.agentConfig.plugins.uninstallDescription',
        'Runs “claude plugin uninstall {{id}} --scope {{scope}}” on {{machine}}.',
        { id: plugin.id, scope, machine: machine.label }
      ),
      confirmLabel: t('auto.components.agentConfig.plugins.uninstallConfirm', 'Uninstall'),
      destructive: true,
      run: () => run({ kind: 'uninstall', plugin: plugin.id, scope }, plugin.id)
    })

  return (
    <div className="space-y-6" data-agent-config-section="plugins">
      {homeScope === 'project' ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {t('auto.components.agentConfig.plugins.writeScope', 'Changes here apply to')}
          </span>
          <SettingsSegmentedControl
            size="sm"
            value={writeScope}
            onChange={setWriteScope}
            ariaLabel={t('auto.components.agentConfig.plugins.writeScope', 'Changes here apply to')}
            options={(['project', 'local'] as const).map((scope) => ({
              value: scope,
              label: agentConfigScopeLabel(scope, t)
            }))}
          />
          <span className="text-xs text-muted-foreground">
            {agentConfigScopeHint(writeScope, t)}
          </span>
        </div>
      ) : null}

      <SettingsGroup
        title={t('auto.components.agentConfig.plugins.installed', 'Installed plugins')}
        description={t(
          'auto.components.agentConfig.plugins.installedDescription',
          'Switching a plugin on or off edits enabledPlugins in the settings file; nothing is downloaded or removed.'
        )}
      >
        {plugins.plugins.length === 0 ? (
          <p data-settings-row="" className="py-3 text-xs text-muted-foreground">
            {t('auto.components.agentConfig.plugins.none', 'No plugins installed.')}
          </p>
        ) : (
          plugins.plugins.map((plugin) => (
            <div
              key={plugin.id}
              data-settings-row=""
              className="flex items-start gap-3 py-2.5"
              data-agent-config-plugin={plugin.id}
            >
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="truncate text-sm font-medium">
                  {plugin.name}
                  <span className="ml-1 font-mono text-xs font-normal text-muted-foreground">
                    @{plugin.marketplace}
                  </span>
                </p>
                {plugin.description ? (
                  <p className="text-xs text-muted-foreground">{plugin.description}</p>
                ) : null}
                <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  {plugin.installs
                    .map((install) =>
                      [
                        install.version,
                        agentConfigScopeLabel(install.scope, t),
                        install.projectPath
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    )
                    .join('; ')}
                  {plugin.enabledBy
                    ? ` — ${t(
                        'auto.components.agentConfig.plugins.decidedBy',
                        '{{state}} by {{scope}} settings',
                        {
                          state: plugin.enabled
                            ? t('auto.components.agentConfig.plugins.on', 'on')
                            : t('auto.components.agentConfig.plugins.offState', 'off'),
                          scope: agentConfigScopeLabel(plugin.enabledBy, t)
                        }
                      )}`
                    : ''}
                </p>
              </div>
              {running === plugin.id ? (
                <Loader2 className="mt-1 size-4 shrink-0 animate-spin text-muted-foreground" />
              ) : null}
              <Switch
                className="mt-0.5"
                checked={plugin.enabled}
                aria-label={t('auto.components.agentConfig.plugins.enable', 'Enable {{name}}', {
                  name: plugin.name
                })}
                onCheckedChange={(enabled) =>
                  void apply(() =>
                    agentConfigApi().setPluginEnabled({
                      target,
                      scope: writeScope,
                      plugin: plugin.id,
                      enabled
                    })
                  )
                }
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t(
                      'auto.components.agentConfig.rowActions',
                      'Actions for {{name}}',
                      { name: plugin.name }
                    )}
                  >
                    <EllipsisVertical />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {plugin.installs.map((install) => (
                    <DropdownMenuItem
                      key={`update:${install.scope}:${install.projectPath ?? ''}`}
                      onSelect={() =>
                        void run(
                          { kind: 'update', plugin: plugin.id, scope: install.scope },
                          plugin.id
                        )
                      }
                    >
                      {t('auto.components.agentConfig.plugins.update', 'Update ({{scope}})', {
                        scope: agentConfigScopeLabel(install.scope, t)
                      })}
                    </DropdownMenuItem>
                  ))}
                  {plugin.enabledIn[writeScope] !== undefined && writeScope !== 'user' ? (
                    <DropdownMenuItem
                      onSelect={() =>
                        void apply(() =>
                          agentConfigApi().setPluginEnabled({
                            target,
                            scope: writeScope,
                            plugin: plugin.id,
                            enabled: null
                          })
                        )
                      }
                    >
                      {t(
                        'auto.components.agentConfig.plugins.inherit',
                        'Stop overriding in {{scope}}',
                        { scope: agentConfigScopeLabel(writeScope, t) }
                      )}
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuSeparator />
                  {plugin.installs.map((install) => (
                    <DropdownMenuItem
                      key={`uninstall:${install.scope}:${install.projectPath ?? ''}`}
                      variant="destructive"
                      onSelect={() => uninstall(plugin, install.scope)}
                    >
                      {t(
                        'auto.components.agentConfig.plugins.uninstall',
                        'Uninstall ({{scope}})…',
                        { scope: agentConfigScopeLabel(install.scope, t) }
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))
        )}
      </SettingsGroup>

      <SettingsGroup
        title={t('auto.components.agentConfig.plugins.marketplaces', 'Marketplaces')}
        description={t(
          'auto.components.agentConfig.plugins.marketplacesDescription',
          'Where plugins come from. Installing runs “claude plugin install” on the machine.'
        )}
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={running !== null}
            onClick={() =>
              setPrompt({
                title: t('auto.components.agentConfig.plugins.addMarketplace', 'Add a marketplace'),
                description: t(
                  'auto.components.agentConfig.plugins.addMarketplaceDescription',
                  'A GitHub repository (owner/repo), a git URL, or a folder on the machine.'
                ),
                confirmLabel: t('auto.components.agentConfig.plugins.add', 'Add'),
                fields: [
                  {
                    id: 'agent-config-marketplace-source',
                    label: t('auto.components.agentConfig.plugins.source', 'Source'),
                    placeholder: t('auto.components.agentConfig.example.marketplace', 'owner/repo'),
                    initialValue: '',
                    validate: (value) =>
                      value === ''
                        ? t('auto.components.agentConfig.plugins.sourceRequired', 'Enter a source.')
                        : null
                  }
                ],
                onSubmit: async ([source]) => {
                  void run({ kind: 'marketplace-add', source: source ?? '' }, '@marketplace')
                }
              })
            }
          >
            {running === '@marketplace' ? <Loader2 className="animate-spin" /> : <Plus />}
            {t('auto.components.agentConfig.plugins.addMarketplaceAction', 'Add marketplace')}
          </Button>
        }
      >
        <AgentConfigMarketplaces
          marketplaces={plugins.marketplaces}
          installScope={writeScope}
          running={running}
          run={run}
          confirm={setConfirm}
        />
      </SettingsGroup>

      {lastRun ? (
        <div
          className="space-y-1 rounded-md border border-border bg-muted/30 p-3 font-mono text-xs"
          data-agent-config-command-output={lastRun.ok ? 'ok' : 'failed'}
        >
          {lastRun.command ? <p className="text-muted-foreground">$ {lastRun.command}</p> : null}
          <pre
            className={cn(
              'scrollbar-sleek max-h-48 overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere]',
              !lastRun.ok && 'text-destructive'
            )}
          >
            {lastRun.output ||
              (lastRun.ok
                ? t('auto.components.agentConfig.plugins.noOutput', 'Finished with no output.')
                : t('auto.components.agentConfig.plugins.failed', 'The command failed.'))}
          </pre>
        </div>
      ) : null}

      <AgentConfigConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
      <MachinePromptDialog request={prompt} onClose={() => setPrompt(null)} />
    </div>
  )
}
