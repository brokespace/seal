import React from 'react'
import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store/index'
import { getRepoExecutionHostId } from '../../../../../shared/execution-host'
import type { Repo } from '../../../../../shared/repo-types'
import { AgentConfigPanel } from '../../agent-config/AgentConfigPanel'
import { agentConfigAvailable } from '../../agent-config/model/agent-config-client'
import { SettingsSubsectionHeader } from '../form-controls/SettingsFormControls'
import { matchesRepositoryIdentitySearch } from '../repository/identity/repository-identity-search'
import { matchesSettingsSearch } from '../search/settings-search'
import { getAgentConfigSearchEntries } from './agent-config-search'
import { useAgentConfigMachines } from './use-agent-config-machines'

/** Decides its own visibility so the project pane needs one line to mount it. */
export function RepositoryAgentConfigSection({ repo }: { repo: Repo }): React.JSX.Element | null {
  const t = useTranslate()
  const searchQuery = useAppStore((state) => state.settingsSearchQuery)
  // Folder projects have agent files too; only the desktop window can reach them.
  if (!agentConfigAvailable()) {
    return null
  }
  const visible =
    matchesRepositoryIdentitySearch(searchQuery, repo) ||
    matchesSettingsSearch(searchQuery, getAgentConfigSearchEntries(repo.displayName, t))
  return visible ? <ProjectAgentConfig repo={repo} /> : null
}

/** A project's own agent files on the machine that holds it, merged with the account's. */
function ProjectAgentConfig({ repo }: { repo: Repo }): React.JSX.Element {
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
