import { useTranslate, type Translate } from '@/i18n/use-translate'
import { PageCard } from '@/components/page-layout/PageCard'
import {
  HomeOverviewEmpty,
  HomeOverviewRowButton
} from '@/components/home-overview/HomeOverviewRow'
import { branchName } from '@/lib/source-control/branches/branch-name'
import type { Worktree } from '../../../../shared/worktree/types'
import { openProjectWorkspace } from './project-overview-actions'
import { isCleanGitChangeSummary, type GitChangeSummary } from './project-overview-model'
import { PROJECT_CHANGES_MAX_WORKTREES, useProjectGitChanges } from './use-project-git'

function changeParts(summary: GitChangeSummary, t: Translate): string[] {
  const parts: string[] = []
  if (summary.conflictOperation) {
    parts.push(
      t('seal.projectOverview.changes.inProgress', '{{operation}} in progress', {
        operation: summary.conflictOperation
      })
    )
  }
  if (summary.conflicted > 0) {
    parts.push(
      t('seal.projectOverview.changes.conflicted', '{{count}} conflicted', {
        count: summary.conflicted
      })
    )
  }
  if (summary.files > 0) {
    parts.push(
      t('seal.projectOverview.changes.files', '{{count}} files changed', {
        count: summary.files,
        defaultValue_one: '{{count}} file changed'
      })
    )
  }
  return parts
}

/** Where the changed files stand: only the kinds that need saying beyond "changed". */
function breakdownParts(summary: GitChangeSummary, t: Translate): string[] {
  const parts: string[] = []
  if (summary.staged > 0) {
    parts.push(
      t('seal.projectOverview.changes.staged', '{{count}} staged', { count: summary.staged })
    )
  }
  if (summary.untracked > 0) {
    parts.push(
      t('seal.projectOverview.changes.untracked', '{{count}} untracked', {
        count: summary.untracked
      })
    )
  }
  return parts
}

function ChangeRow({
  worktree,
  summary
}: {
  worktree: Worktree
  summary: GitChangeSummary | null | undefined
}): React.JSX.Element {
  const t = useTranslate()
  let detail: React.ReactNode
  if (summary === undefined) {
    detail = t('seal.projectOverview.changes.reading', 'Reading…')
  } else if (summary === null) {
    detail = t('seal.projectOverview.changes.unavailable', 'Status unavailable')
  } else if (isCleanGitChangeSummary(summary)) {
    detail = t('seal.projectOverview.changes.clean', 'Clean')
  } else if (changeParts(summary, t).length === 0) {
    // Only ahead of or behind its upstream, which the first line shows.
    detail = t('seal.projectOverview.changes.nothingUncommitted', 'Nothing uncommitted')
  } else {
    const breakdown = breakdownParts(summary, t)
    detail = (
      <>
        {changeParts(summary, t).join(' · ')}
        {summary.added > 0 || summary.removed > 0 ? (
          <span className="ml-1.5 tabular-nums">
            <span className="text-[color:var(--git-decoration-added)]">+{summary.added}</span>{' '}
            <span className="text-[color:var(--git-decoration-deleted)]">−{summary.removed}</span>
          </span>
        ) : null}
        {breakdown.length > 0 ? ` · ${breakdown.join(' · ')}` : null}
      </>
    )
  }
  const upstream = summary?.upstream
  return (
    <HomeOverviewRowButton
      onClick={() => openProjectWorkspace(worktree)}
      className="flex-col items-stretch gap-0.5 px-1.5 py-1.5"
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
          {branchName(worktree.branch) || worktree.displayName}
        </span>
        {upstream && (upstream.ahead > 0 || upstream.behind > 0) ? (
          <span
            className="shrink-0 text-2xs text-muted-foreground tabular-nums"
            title={t(
              'seal.projectOverview.changes.aheadBehind',
              '{{ahead}} ahead of and {{behind}} behind {{upstream}}',
              {
                ahead: upstream.ahead,
                behind: upstream.behind,
                upstream: upstream.name ?? t('seal.projectOverview.changes.upstream', 'upstream')
              }
            )}
          >
            ↑{upstream.ahead} ↓{upstream.behind}
          </span>
        ) : null}
      </span>
      <span className="truncate text-2xs text-muted-foreground">{detail}</span>
    </HomeOverviewRowButton>
  )
}

/** Uncommitted work and unpushed commits in each workspace, with a way into the workspace. */
export function ProjectChangesCard({
  worktrees
}: {
  worktrees: readonly Worktree[]
}): React.JSX.Element {
  const t = useTranslate()
  const changes = useProjectGitChanges(worktrees)
  const shown = worktrees.slice(0, PROJECT_CHANGES_MAX_WORKTREES)
  return (
    <PageCard title={t('seal.projectOverview.changes.title', 'Changes')}>
      {shown.length === 0 ? (
        <HomeOverviewEmpty>
          {t('seal.projectOverview.changes.empty', 'No workspaces to check.')}
        </HomeOverviewEmpty>
      ) : (
        <ul className="px-1.5 py-1.5" data-project-overview-changes>
          {shown.map((worktree) => (
            <li key={worktree.id}>
              <ChangeRow
                worktree={worktree}
                summary={changes.status === 'ready' ? changes.data.get(worktree.id) : undefined}
              />
            </li>
          ))}
        </ul>
      )}
      {worktrees.length > shown.length ? (
        <p className="border-t border-border px-3 py-2 text-2xs text-muted-foreground">
          {t(
            'seal.projectOverview.changes.more',
            'Showing the first {{shown}} of {{total}} workspaces.',
            { shown: shown.length, total: worktrees.length }
          )}
        </p>
      ) : null}
    </PageCard>
  )
}
