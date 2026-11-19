import React, { useState } from 'react'
import { useTranslate } from '@/i18n/use-translate'
import { AgentConnectorsSection } from '../../agent-connectors/AgentConnectorsSection'
import { MachineStatusCombobox } from '../agent-config/MachineStatusCombobox'
import { useAgentConfigMachines } from '../agent-config/use-agent-config-machines'
import { SettingsRow } from '../form-controls/SettingsFormControls'
import { SettingsGroup } from '../section-layout/SettingsGroup'
import { INTEGRATION_SETTING_TARGET_IDS } from './integrations-search'

/** The MCP connectors agents themselves use, which the task-provider cards above do not cover. */
export function AgentConnectorsSettingsGroup(): React.JSX.Element {
  const t = useTranslate()
  const { machines } = useAgentConfigMachines()
  const [machineId, setMachineId] = useState<string | null>(null)
  const machine = machines.find((item) => item.id === machineId) ?? machines[0]

  return (
    <div className="space-y-6">
      <SettingsGroup
        id={INTEGRATION_SETTING_TARGET_IDS.agentConnectors}
        title={t('auto.components.settings.IntegrationsPane.agentConnectors', 'Agent connectors')}
        description={t(
          'auto.components.settings.IntegrationsPane.agentConnectorsDescription',
          'The MCP connectors (Jira, Slack and others) agents use. Each account an agent runs as signs in on its own.'
        )}
      >
        <SettingsRow
          label={t('auto.components.agentConfig.pane.machine', 'Machine')}
          description={t(
            'auto.components.settings.IntegrationsPane.agentConnectorsMachine',
            'Where the agents run. Seal checks every account it launches agents with there.'
          )}
          control={
            <div className="w-56" data-agent-connectors-machine="">
              <MachineStatusCombobox
                machines={machines}
                value={machine?.id ?? ''}
                onChange={setMachineId}
                ariaLabel={t('auto.components.agentConfig.pane.machine', 'Machine')}
              />
            </div>
          }
        />
      </SettingsGroup>
      {machine ? (
        <AgentConnectorsSection
          key={machine.id}
          machineId={machine.id}
          machineLabel={machine.label}
        />
      ) : null}
    </div>
  )
}
