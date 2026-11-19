import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useTranslate } from '@/i18n/use-translate'
import { preferredAgentPluginListings } from '../../../../shared/agent-plugins/agent-plugin-catalog'
import { targetsInclude } from '../../../../shared/agent-plugins/agent-plugin-targets'
import {
  AGENT_PLUGIN_ALL_TARGETS,
  type AgentPluginMachineResult
} from '../../../../shared/agent-plugins/agent-plugin-types'
import {
  AgentConfigConfirmDialog,
  type AgentConfigConfirmRequest
} from '../agent-config/AgentConfigConfirmDialog'
import { agentConfigApi } from '../agent-config/model/agent-config-client'
import { AgentConnectorsSection } from '../agent-connectors/AgentConnectorsSection'
import { SettingsRow } from '../settings/form-controls/SettingsFormControls'
import { SettingsGroup } from '../settings/section-layout/SettingsGroup'
import { MachineStatusCombobox } from '../settings/agent-config/MachineStatusCombobox'
import { useAgentConfigMachines } from '../settings/agent-config/use-agent-config-machines'
import { AgentPluginApplyDialog, type AgentPluginApplyRequest } from './AgentPluginApplyDialog'
import { AgentPluginsBrowse } from './AgentPluginsBrowse'
import { AgentPluginsInstalled } from './AgentPluginsInstalled'
import { useAgentPluginTargetOptions } from './AgentPluginTargetPicker'
import { failedMachineResult, useAgentPluginsFleet } from './use-agent-plugins-fleet'

type TabId = 'installed' | 'browse' | 'connectors'

/** Plugins from every agent's marketplaces, installed once for every agent, account and machine. */
export function AgentPluginsPane(): React.JSX.Element {
  const t = useTranslate()
  const { machines } = useAgentConfigMachines()
  const [machineId, setMachineId] = useState<string | null>(null)
  const machine = machines.find((item) => item.id === machineId) ?? machines[0]
  const [tab, setTab] = useState<TabId>('installed')
  const [apply, setApply] = useState<AgentPluginApplyRequest | null>(null)
  const [confirm, setConfirm] = useState<AgentConfigConfirmRequest | null>(null)
  const fleet = useAgentPluginsFleet(machines)
  const options = useAgentPluginTargetOptions(machines)
  const here = machine ? fleet.states.get(machine.id) : undefined
  const inventory = here?.kind === 'ready' ? here.inventory : null
  const installedNames = useMemo(
    () => new Set(fleet.entries.map((entry) => entry.name)),
    [fleet.entries]
  )

  const { reload } = fleet
  const report = useCallback(
    (results: AgentPluginMachineResult[], done: string): void => {
      const failed = results.filter((result) => !result.ok)
      if (failed.length === 0) {
        toast.success(done)
      } else {
        toast.error(
          t('seal.agentPlugins.someFailed', 'Not finished on {{machines}}', {
            machines: failed
              .map(
                (result) =>
                  machines.find((m) => m.id === result.machineId)?.label ?? result.machineId
              )
              .join(', ')
          }),
          {
            description: failed
              .map((result) => result.error ?? result.steps.find((s) => !s.ok)?.output)
              .filter(Boolean)
              .join('\n')
          }
        )
      }
      reload()
    },
    [machines, reload, t]
  )

  // A plugin follows the user onto targeted machines that were offline or added since.
  const reconciled = useRef(new Set<string>())
  useEffect(() => {
    if ([...fleet.states.values()].some((state) => state.kind === 'loading')) {
      return
    }
    const work = fleet.entries.flatMap((entry) =>
      [...fleet.states.entries()]
        .filter(([id, state]) => state.kind === 'ready' && !entry.byMachine.has(id))
        .filter(([id]) => targetsInclude(entry.targets.machines, id))
        .filter(([id]) => !reconciled.current.has(`${entry.name}\n${id}`))
        .map(([id]) => ({ entry, machineId: id }))
    )
    if (work.length === 0) {
      return
    }
    for (const item of work) {
      reconciled.current.add(`${item.entry.name}\n${item.machineId}`)
    }
    void Promise.all(
      work.map(({ entry, machineId: target }) =>
        agentConfigApi()
          .installAgentPlugin({
            machineId: target,
            request: { name: entry.name, listings: entry.listings, targets: entry.targets }
          })
          .catch((error: unknown) => failedMachineResult(target, error))
      )
    ).then((results) =>
      report(results, t('seal.agentPlugins.reconciled', 'Installed on machines that came online'))
    )
  }, [fleet.entries, fleet.states, report, t])

  const tabs: { id: TabId; label: string }[] = [
    { id: 'installed', label: t('seal.agentPlugins.tabs.installed', 'Installed') },
    { id: 'browse', label: t('seal.agentPlugins.tabs.browse', 'Browse') },
    { id: 'connectors', label: t('seal.agentPlugins.tabs.connectors', 'Connectors') }
  ]

  return (
    <div className="space-y-6" data-agent-plugins-pane="">
      <SettingsGroup>
        <SettingsRow
          label={t('seal.agentPlugins.machine', 'Machine')}
          description={t(
            'seal.agentPlugins.machineDescription',
            'Whose marketplaces to browse and what each agent got there. Installing reaches every machine unless you choose otherwise.'
          )}
          control={
            <div className="w-56" data-agent-plugins-machine="">
              <MachineStatusCombobox
                machines={machines}
                value={machine?.id ?? ''}
                onChange={setMachineId}
                ariaLabel={t('seal.agentPlugins.machine', 'Machine')}
              />
            </div>
          }
        />
      </SettingsGroup>
      {here?.kind === 'failed' ? (
        <p className="text-xs text-destructive [overflow-wrap:anywhere]" role="alert">
          {here.error}
        </p>
      ) : null}
      {machine && machine.status !== 'online' ? (
        <p className="text-xs text-muted-foreground">
          {t('seal.agentPlugins.offline', 'Connect to {{machine}} to see its plugins.', {
            machine: machine.label
          })}
        </p>
      ) : null}

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(tabs.find((item) => item.id === value)?.id ?? 'installed')}
      >
        <TabsList size="sm" className="justify-start">
          {tabs.map((item) => (
            <TabsTrigger
              key={item.id}
              value={item.id}
              className="flex-none"
              data-agent-plugins-tab={item.id}
            >
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="installed" className="mt-2">
          <AgentPluginsInstalled
            entries={fleet.entries}
            unshared={inventory?.unshared ?? []}
            machineId={machine?.id ?? null}
            options={options}
            onToggle={(entry, enabled) =>
              void Promise.all(
                [...entry.byMachine.keys()].map((target) =>
                  agentConfigApi()
                    .setAgentPluginEnabled({ machineId: target, name: entry.name, enabled })
                    .catch((error: unknown) => failedMachineResult(target, error))
                )
              ).then((results) =>
                report(
                  results,
                  enabled
                    ? t('seal.agentPlugins.switchedOn', '{{name}} is on', { name: entry.name })
                    : t('seal.agentPlugins.switchedOff', '{{name}} is off', { name: entry.name })
                )
              )
            }
            onRetarget={(entry) =>
              setApply({
                name: entry.name,
                description: entry.description,
                listings: entry.listings,
                components:
                  here?.kind === 'ready'
                    ? (here.inventory.plugins.find((p) => p.name === entry.name)?.components ??
                      null)
                    : null,
                targets: entry.targets,
                installedOn: [...entry.byMachine.keys()],
                presentAgents: inventory?.presentAgents ?? []
              })
            }
            onRemove={(entry) =>
              setConfirm({
                title: t('seal.agentPlugins.removeTitle', 'Remove {{name}}?', { name: entry.name }),
                description: [
                  t(
                    'seal.agentPlugins.removeDescription',
                    'Seal takes its MCP servers and skill links out of every agent, then each agent’s own plugin command uninstalls it, on {{count}} machines.',
                    { count: entry.byMachine.size }
                  ),
                  ...([...entry.byMachine.values()].some((plugin) =>
                    plugin.listings.some((listing) => listing.preexisting)
                  )
                    ? [
                        t(
                          'seal.agentPlugins.removeKeepsPreexisting',
                          'Installed before Seal on some machines; Seal will stop managing it there but won’t uninstall it.'
                        )
                      ]
                    : [])
                ].join(' '),
                confirmLabel: t('seal.agentPlugins.removeConfirm', 'Remove'),
                destructive: true,
                run: async () => {
                  const results = await Promise.all(
                    [...entry.byMachine.keys()].map((target) =>
                      agentConfigApi()
                        .removeAgentPlugin({ machineId: target, name: entry.name })
                        .catch((error: unknown) => failedMachineResult(target, error))
                    )
                  )
                  report(
                    results,
                    t('seal.agentPlugins.removed', 'Removed {{name}}', { name: entry.name })
                  )
                }
              })
            }
            onShare={(plugin) =>
              setApply({
                name: plugin.name,
                description: '',
                listings: [{ harness: plugin.harness, id: plugin.id }],
                components: null,
                targets: AGENT_PLUGIN_ALL_TARGETS,
                installedOn: [],
                presentAgents: inventory?.presentAgents ?? []
              })
            }
          />
        </TabsContent>
        <TabsContent value="browse" className="mt-2">
          {machine && machine.status === 'online' ? (
            <AgentPluginsBrowse
              machineId={machine.id}
              installed={installedNames}
              onInstall={(entry) =>
                setApply({
                  name: entry.name,
                  description: entry.description,
                  listings: preferredAgentPluginListings(entry),
                  components: entry.components,
                  targets: AGENT_PLUGIN_ALL_TARGETS,
                  installedOn: [],
                  presentAgents: inventory?.presentAgents ?? []
                })
              }
            />
          ) : null}
        </TabsContent>
        {machine ? (
          <TabsContent value="connectors" className="mt-2">
            <AgentConnectorsSection machineId={machine.id} machineLabel={machine.label} />
          </TabsContent>
        ) : null}
      </Tabs>

      <AgentPluginApplyDialog
        request={apply}
        machines={machines}
        options={options}
        onClose={() => setApply(null)}
        onApplied={fleet.reload}
      />
      <AgentConfigConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </div>
  )
}
