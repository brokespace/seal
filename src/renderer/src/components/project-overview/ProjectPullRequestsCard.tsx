import { GitPullRequest, GitPullRequestDraft } from 'lucide-react'
import { useAppStore } from '@/store'
import { useTranslate } from '@/i18n/use-translate'
import { PageCard } from '@/components/page-layout/PageCard'
import {
  HomeOverviewEmpty,
  HomeOverviewRowButton
} from '@/components/home-overview/HomeOverviewRow'
import { openAppHttpLink } from '@/lib/browser/navigation/app-http-link-open'
import { branchName } from '@/lib/source-control/branches/branch-name'
import type { GitHubWorkItem } from '../../../../shared/github/work-items/work-item-types'
import type { Repo } from '../../../../shared/repository/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { useProjectOverviewLoad } from './use-project-overview-load'

const MAX_PULL_REQUESTS = 8

/** Open pull requests of the project's repository, naming the workspace that holds each branch. */
export function ProjectPullRequestsCard({
  repo,
  worktrees
}: {
  repo: Repo
  worktrees: readonly Worktree[]
}): React.JSX.Element {
  const t = useTranslate()
  const pulls = useProjectOverviewLoad(`${repo.id}\n${repo.path}`, async () => {
    // A failed or superseded read must not read as "no pull requests".
    const items = await useAppStore
      .getState()
      .fetchWorkItems(repo.id, repo.path, MAX_PULL_REQUESTS, 'is:pr is:open', {
        requireComplete: true
      })
    if (!items) {
      throw new Error('Pull requests were not read.')
    }
    return items.filter((item) => item.type === 'pr')
  })
  const workspaceOf = (item: GitHubWorkItem): Worktree | undefined =>
    worktrees.find(
      (worktree) =>
        worktree.linkedPR === item.number ||
        (item.branchName !== undefined && branchName(worktree.branch) === item.branchName)
    )
  return (
    <PageCard
      title={t('seal.projectOverview.pulls.title', 'Pull requests')}
      action={
        pulls.status === 'ready' ? (
          <span className="text-2xs text-muted-foreground tabular-nums">{pulls.data.length}</span>
        ) : undefined
      }
    >
      {pulls.status === 'loading' ? (
        <HomeOverviewEmpty>
          {t('seal.projectOverview.pulls.loading', 'Loading pull requests…')}
        </HomeOverviewEmpty>
      ) : pulls.status === 'error' ? (
        <HomeOverviewEmpty>
          {t(
            'seal.projectOverview.pulls.unavailable',
            'Pull requests could not be loaded for this repository.'
          )}
        </HomeOverviewEmpty>
      ) : pulls.data.length === 0 ? (
        <HomeOverviewEmpty>
          {t('seal.projectOverview.pulls.empty', 'No open pull requests.')}
        </HomeOverviewEmpty>
      ) : (
        <ul className="px-1.5 py-1.5" data-project-overview-pulls>
          {pulls.data.map((item) => {
            const workspace = workspaceOf(item)
            const Icon = item.state === 'draft' ? GitPullRequestDraft : GitPullRequest
            return (
              <li key={item.id}>
                <HomeOverviewRowButton
                  onClick={() => openAppHttpLink(item.url)}
                  className="items-start px-1.5 py-1.5"
                >
                  <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs text-foreground">{item.title}</span>
                    <span className="block truncate text-2xs text-muted-foreground">
                      {[
                        `#${item.number}`,
                        item.state === 'draft'
                          ? t('seal.projectOverview.pulls.draft', 'Draft')
                          : null,
                        item.author,
                        workspace?.displayName
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                </HomeOverviewRowButton>
              </li>
            )
          })}
        </ul>
      )}
    </PageCard>
  )
}
