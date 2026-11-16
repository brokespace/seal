import { useTranslate } from '@/i18n/use-translate'
import { Button } from '@/components/ui/button'
import { PageCard } from '@/components/page-layout/PageCard'
import { ProjectAgentConfigPanel } from '@/components/settings/agent-config/RepositoryAgentConfigSection'
import { getRepositoryAgentConfigSectionId } from '@/components/settings/repository/repository-settings-targets'
import type { Repo } from '../../../../shared/repository/repo-types'
import { openProjectSettings } from './project-overview-actions'

/**
 * Skills, instructions, MCP servers, plugins and settings the project gives its agents. The panel
 * is the one in the project's Settings pane, so discovery and editing have one implementation.
 */
export function ProjectAgentConfigCard({ repo }: { repo: Repo }): React.JSX.Element {
  const t = useTranslate()
  return (
    <PageCard
      title={t('auto.components.agentConfig.project.title', 'Agent configuration')}
      action={
        <Button
          type="button"
          variant="ghost"
          size="xs"
          data-project-overview-edit-config
          onClick={() => openProjectSettings(repo, getRepositoryAgentConfigSectionId(repo.id))}
        >
          {t('seal.projectOverview.config.editInSettings', 'Edit in settings')}
        </Button>
      }
    >
      <div className="p-3" data-agent-config-project={repo.id}>
        <ProjectAgentConfigPanel repo={repo} />
      </div>
    </PageCard>
  )
}
