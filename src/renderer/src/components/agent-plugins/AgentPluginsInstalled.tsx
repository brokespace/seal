import React from 'react'
import { EllipsisVertical } from 'lucide-react'
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
import type { AgentPluginUnshared } from '../../../../shared/agent-plugins/agent-plugin-types'
import type { MachineId } from '../../../../shared/machines/machine-types'
import { SettingsGroup } from '../settings/section-layout/SettingsGroup'
import { AgentPluginAgentList, linesFromStates } from './AgentPluginAgentList'
import type { AgentPluginTargetOptions } from './AgentPluginTargetPicker'
import type { AgentPluginFleetEntry } from './use-agent-plugins-fleet'

const HARNESS_LABELS = { claude: 'Claude Code', codex: 'Codex' } as const

/** Plugins the hub manages, across machines, with what each agent got on the chosen machine. */
export function AgentPluginsInstalled({
  entries,
  unshared,
  machineId,
  options,
  onToggle,
  onRetarget,
  onRemove,
  onShare
}: {
  entries: readonly AgentPluginFleetEntry[]
  /** Native installs on the chosen machine that only their own agent has. */
  unshared: readonly AgentPluginUnshared[]
  machineId: MachineId | null
  options: AgentPluginTargetOptions
  onToggle: (entry: AgentPluginFleetEntry, enabled: boolean) => void
  onRetarget: (entry: AgentPluginFleetEntry) => void
  onRemove: (entry: AgentPluginFleetEntry) => void
  onShare: (plugin: AgentPluginUnshared) => void
}): React.JSX.Element {
  const t = useTranslate()
  const where = (entry: AgentPluginFleetEntry): string => {
    const accounts =
      entry.targets.accounts === 'all'
        ? t('seal.agentPlugins.installed.allAccounts', 'all accounts')
        : t('seal.agentPlugins.installed.someAccounts', '{{count}} of {{total}} accounts', {
            count: entry.targets.accounts.length,
            total: options.accounts.length
          })
    const agents =
      entry.targets.agents === 'all'
        ? ''
        : ` · ${t('seal.agentPlugins.installed.someAgents', '{{count}} of {{total}} agents', {
            count: entry.targets.agents.length,
            total: options.agents.length
          })}`
    return `${t('seal.agentPlugins.installed.machines', '{{count}} of {{total}} machines', {
      count: entry.byMachine.size,
      total: options.machines.length
    })} · ${accounts}${agents}`
  }

  return (
    <div className="space-y-6" data-agent-plugins-installed="">
      <SettingsGroup
        title={t('seal.agentPlugins.installed.title', 'Installed for every agent')}
        description={t(
          'seal.agentPlugins.installed.description',
          'What each agent got is shown for the chosen machine. Switching a plugin off takes it out of every agent and keeps the install.'
        )}
      >
        {entries.length === 0 ? (
          <p data-settings-row="" className="py-3 text-xs text-muted-foreground">
            {t('seal.agentPlugins.installed.none', 'Nothing installed through Seal yet.')}
          </p>
        ) : (
          entries.map((entry) => {
            const here =
              (machineId ? entry.byMachine.get(machineId) : undefined) ??
              [...entry.byMachine.values()][0]
            return (
              <div
                key={entry.name}
                data-settings-row=""
                className="flex items-start gap-3 py-2.5"
                data-agent-plugin-installed={entry.name}
              >
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="truncate text-sm font-medium">
                    {entry.name}
                    {here?.version ? (
                      <span className="ml-1 font-mono text-xs font-normal text-muted-foreground">
                        {here.version}
                      </span>
                    ) : null}
                  </p>
                  {entry.description ? (
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                      {entry.description}
                    </p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">{where(entry)}</p>
                  {here ? <AgentPluginAgentList lines={linesFromStates(here.agents)} /> : null}
                </div>
                <Switch
                  className="mt-0.5"
                  checked={entry.enabled}
                  aria-label={t('seal.agentPlugins.installed.enable', 'Use {{name}}', {
                    name: entry.name
                  })}
                  onCheckedChange={(enabled) => onToggle(entry, enabled)}
                />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t('seal.agentPlugins.installed.actions', 'Actions for {{name}}', {
                        name: entry.name
                      })}
                    >
                      <EllipsisVertical />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => onRetarget(entry)}>
                      {t('seal.agentPlugins.installed.retarget', 'Change where it applies…')}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => onRemove(entry)}>
                      {t('seal.agentPlugins.installed.remove', 'Remove from every machine…')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )
          })
        )}
      </SettingsGroup>

      {unshared.length > 0 ? (
        <SettingsGroup
          title={t('seal.agentPlugins.unshared.title', 'Installed for one agent only')}
          description={t(
            'seal.agentPlugins.unshared.description',
            'Installed with the agent’s own plugin command on this machine. Sharing gives the other agents its MCP servers and skills.'
          )}
        >
          {unshared.map((plugin) => (
            <div
              key={`${plugin.harness}:${plugin.id}`}
              data-settings-row=""
              className="flex items-center gap-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{plugin.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {HARNESS_LABELS[plugin.harness]} · {plugin.id}
                  {plugin.enabled ? '' : ` · ${t('seal.agentPlugins.unshared.off', 'off')}`}
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => onShare(plugin)}>
                {t('seal.agentPlugins.unshared.share', 'Share with every agent…')}
              </Button>
            </div>
          ))}
        </SettingsGroup>
      ) : null}
    </div>
  )
}
