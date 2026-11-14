import React, { useState } from 'react'
import { useTranslate } from '@/i18n/use-translate'
import { HostCombobox } from '../../host-picker/HostCombobox'
import { AgentConfigPanel } from '../../agent-config/AgentConfigPanel'
import { MachineStatusDot } from '../../machines/detail/MachineVitals'
import { SettingsRow } from '../form-controls/SettingsFormControls'
import { SettingsGroup } from '../section-layout/SettingsGroup'
import { useAgentConfigMachines } from './use-agent-config-machines'

/** What each agent is set up with on a machine, for every project there. */
export function AgentConfigSettingsPane(): React.JSX.Element {
  const t = useTranslate()
  const { machines, projects } = useAgentConfigMachines()
  const [machineId, setMachineId] = useState<string | null>(null)
  const machine = machines.find((item) => item.id === machineId) ?? machines[0]

  return (
    <div className="space-y-6">
      <SettingsGroup>
        <SettingsRow
          label={t('auto.components.agentConfig.pane.machine', 'Machine')}
          description={t(
            'auto.components.agentConfig.pane.machineDescription',
            'Each machine has its own agent configuration. A project’s own files are in that project’s settings.'
          )}
          control={
            <div className="w-56" data-agent-config-machine="">
              <HostCombobox
                value={machine?.id ?? ''}
                onChange={setMachineId}
                ariaLabel={t('auto.components.agentConfig.pane.machine', 'Machine')}
                options={machines.map((item) => ({
                  id: item.id,
                  label: item.label,
                  content: (
                    <span className="flex min-w-0 items-center gap-2">
                      <MachineStatusDot status={item.status} />
                      <span className="truncate">{item.label}</span>
                    </span>
                  )
                }))}
              />
            </div>
          }
        />
      </SettingsGroup>
      {machine ? (
        <AgentConfigPanel
          key={machine.id}
          machine={machine}
          machines={machines}
          projects={projects}
        />
      ) : null}
    </div>
  )
}
