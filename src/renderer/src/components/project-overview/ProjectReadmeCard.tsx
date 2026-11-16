import { Suspense } from 'react'
import { useTranslate } from '@/i18n/use-translate'
import { Button } from '@/components/ui/button'
import { PageCard } from '@/components/page-layout/PageCard'
import { MarkdownPreview } from '@/components/editor/editor-lazy-views'
import { openMachinePathInEditor } from '@/components/machines/editor/machine-editor-open'
import type { MachineSummary } from '../../../../shared/machines/machine-summaries'
import type { Repo } from '../../../../shared/repository/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { openProjectMachine, openProjectWorkspace } from './project-overview-actions'
import { useProjectReadme } from './use-project-readme'

/** The project's own description. Left out when it has no README or its machine cannot be read. */
export function ProjectReadmeCard({
  repo,
  machine,
  mainWorktree
}: {
  repo: Repo
  machine: MachineSummary | null
  mainWorktree: Worktree | null
}): React.JSX.Element | null {
  const t = useTranslate()
  const online = machine?.status === 'online'
  const readme = useProjectReadme(online ? machine.id : null, repo.path)
  if (!machine || readme.status !== 'ready' || readme.data === null) {
    return null
  }
  const { path, text, truncated } = readme.data
  return (
    <PageCard
      title={t('seal.projectOverview.readme.title', 'Readme')}
      action={
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() =>
            void openMachinePathInEditor(
              machine,
              { path, kind: 'file' },
              {
                openBuiltIn: () => {
                  if (mainWorktree) {
                    openProjectWorkspace(mainWorktree)
                  }
                },
                addSshDetails: () => openProjectMachine(machine)
              }
            )
          }
        >
          {t('seal.projectOverview.readme.open', 'Open')}
        </Button>
      }
    >
      <div
        data-project-overview-readme
        className="scrollbar-editor max-h-[28rem] overflow-auto rounded-b-xl"
      >
        <Suspense fallback={null}>
          <MarkdownPreview
            content={text}
            filePath={path}
            scrollCacheKey={`project-overview:${machine.id}:${path}`}
          />
        </Suspense>
      </div>
      {truncated ? (
        <p className="border-t border-border px-3 py-2 text-2xs text-muted-foreground">
          {t('seal.projectOverview.readme.truncated', 'Showing the beginning of a long file.')}
        </p>
      ) : null}
    </PageCard>
  )
}
