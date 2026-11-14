import React, { useState } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useTranslate } from '@/i18n/use-translate'
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
            <Select value={machine?.id ?? ''} onValueChange={setMachineId}>
              <SelectTrigger
                className="w-56"
                aria-label={t('auto.components.agentConfig.pane.machine', 'Machine')}
                data-agent-config-machine=""
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {machines.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    <span className="flex items-center gap-2">
                      <MachineStatusDot status={item.status} />
                      {item.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
