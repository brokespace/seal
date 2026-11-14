import { useTranslate } from '@/i18n/use-translate'
import { PageCard } from '@/components/page-layout/PageCard'
import { HomeOverviewEmpty } from '@/components/home-overview/HomeOverviewRow'
import { formatHomeDuration } from '@/components/home-overview/home-overview-presentation'
import { branchName } from '@/lib/source-control/branches/branch-name'
import type { Worktree } from '../../../../shared/worktree/types'
import { useProjectRecentCommits } from './use-project-git'

/** The latest commits on the main checkout: what changed in the code, and when. */
export function ProjectCommitsCard({
  worktree,
  now
}: {
  worktree: Worktree | null
  now: number
}): React.JSX.Element {
  const t = useTranslate()
  const commits = useProjectRecentCommits(worktree)
  const branch = worktree ? branchName(worktree.branch) : ''
  return (
    <PageCard
      title={t('seal.projectOverview.commits.title', 'Recent commits')}
      action={
        branch ? (
          <span className="min-w-0 truncate font-mono text-2xs text-muted-foreground">
            {branch}
          </span>
        ) : undefined
      }
    >
      {!worktree ? (
        <HomeOverviewEmpty>
          {t('seal.projectOverview.commits.noCheckout', 'No checkout to read commits from.')}
        </HomeOverviewEmpty>
      ) : commits.status === 'loading' ? (
        <HomeOverviewEmpty>
          {t('seal.projectOverview.commits.loading', 'Loading commits…')}
        </HomeOverviewEmpty>
      ) : commits.status === 'error' ? (
        <HomeOverviewEmpty>
          {t(
            'seal.projectOverview.commits.unavailable',
            'Commits could not be read. The project’s machine may not be connected.'
          )}
        </HomeOverviewEmpty>
      ) : commits.data.length === 0 ? (
        <HomeOverviewEmpty>
          {t('seal.projectOverview.commits.empty', 'No commits yet.')}
        </HomeOverviewEmpty>
      ) : (
        <ol className="space-y-2 px-3 py-2.5" data-project-overview-commits>
          {commits.data.map((commit) => {
            const age = commit.timestamp ? formatHomeDuration(commit.timestamp, now) : null
            return (
              <li key={commit.id} className="min-w-0">
                <p className="truncate text-xs text-foreground" title={commit.subject}>
                  {commit.subject}
                </p>
                <p className="truncate text-2xs text-muted-foreground">
                  {[
                    <span key="id" className="font-mono">
                      {commit.displayId ?? commit.id.slice(0, 7)}
                    </span>,
                    commit.author,
                    age
                  ]
                    .filter(Boolean)
                    .flatMap((part, index) => (index === 0 ? [part] : [' · ', part]))}
                </p>
              </li>
            )
          })}
        </ol>
      )}
    </PageCard>
  )
}
