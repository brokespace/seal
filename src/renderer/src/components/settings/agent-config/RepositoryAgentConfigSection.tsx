import React from 'react'
import { useTranslate } from '@/i18n/use-translate'
import { getRepoExecutionHostId } from '../../../../../shared/execution-host'
import type { Repo } from '../../../../../shared/repo-types'
import { AgentConfigPanel } from '../../agent-config/AgentConfigPanel'
import { SettingsSubsectionHeader } from '../form-controls/SettingsFormControls'
import { useAgentConfigMachines } from './use-agent-config-machines'

/** A project's own agent files on the machine that holds it, merged with the account's. */
export function RepositoryAgentConfigSection({ repo }: { repo: Repo }): React.JSX.Element {
  const t = useTranslate()
  const { machines, projects } = useAgentConfigMachines()
  const hostId = getRepoExecutionHostId(repo)
  const machine = machines.find((item) => item.executionHostId === hostId)

  return (
    <section className="space-y-3" data-agent-config-project={repo.id}>
      <SettingsSubsectionHeader
        title={t('auto.components.agentConfig.project.title', 'Agent configuration')}
        description={t(
          'auto.components.agentConfig.project.description',
          'Instructions, skills, MCP servers, plugins and settings this project gives its agents, and how they combine with the account’s.'
        )}
      />
      {machine ? (
        <AgentConfigPanel
          key={`${machine.id}\n${repo.path}`}
          machine={machine}
          machines={machines}
          projects={projects}
          projectPath={repo.path}
        />
      ) : (
        <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
          {t(
            'auto.components.agentConfig.project.noMachine',
            'The machine this project is on is not connected in Seal.'
          )}
        </p>
      )}
    </section>
  )
}
