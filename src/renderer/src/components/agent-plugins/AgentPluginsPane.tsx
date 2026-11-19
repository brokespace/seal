import React, { useState } from 'react'
import { useTranslate } from '@/i18n/use-translate'
import { SettingsRow } from '../settings/form-controls/SettingsFormControls'
import { SettingsGroup } from '../settings/section-layout/SettingsGroup'
import { MachineStatusCombobox } from '../settings/agent-config/MachineStatusCombobox'
import { useAgentConfigMachines } from '../settings/agent-config/use-agent-config-machines'
import { AgentPluginsBrowse } from './AgentPluginsBrowse'

/** Browse-only until the central plugin library takes installs. */
export function AgentPluginsPane(): React.JSX.Element {
  const t = useTranslate()
  const { machines } = useAgentConfigMachines()
  const [machineId, setMachineId] = useState<string | null>(null)
  const machine = machines.find((item) => item.id === machineId) ?? machines[0]

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
      {machine && machine.status !== 'online' ? (
        <p className="text-xs text-muted-foreground">
          {t('seal.agentPlugins.offline', 'Connect to {{machine}} to see its plugins.', {
            machine: machine.label
          })}
        </p>
      ) : null}
      {machine && machine.status === 'online' ? (
        <AgentPluginsBrowse machineId={machine.id} />
      ) : null}
    </div>
  )
}
