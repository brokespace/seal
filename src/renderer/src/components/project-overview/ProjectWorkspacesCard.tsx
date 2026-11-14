import { useAppStore } from '@/store'
import { useTranslate } from '@/i18n/use-translate'
import { PageCard } from '@/components/page-layout/PageCard'
import { HomeOverviewEmpty } from '@/components/home-overview/HomeOverviewRow'
import WorktreeCard from '@/components/sidebar/workspace-card/surface/WorktreeCard'
import { getWorktreeHostIdentity } from '../../../../shared/worktree/host-qualified-identity'
import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'

/**
 * The project's workspaces as the sidebar draws them: the same card, click and context menu, so
 * renaming, pinning, deleting and opening work here without a second set of handlers.
 */
export function ProjectWorkspacesCard({
  repo,
  worktrees
}: {
  repo: Repo
  worktrees: readonly Worktree[]
}): React.JSX.Element {
  const t = useTranslate()
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  return (
    <PageCard
      title={t('seal.projectOverview.workspaces.title', 'Workspaces')}
      action={
        <span className="text-2xs text-muted-foreground tabular-nums">{worktrees.length}</span>
      }
    >
      {worktrees.length === 0 ? (
        <HomeOverviewEmpty>
          {t(
            'seal.projectOverview.workspaces.empty',
            'No workspaces yet. New agent creates one for its work.'
          )}
        </HomeOverviewEmpty>
      ) : (
        <div data-project-overview-workspaces className="space-y-1 p-2">
          {worktrees.map((worktree) => (
            <WorktreeCard
              key={getWorktreeHostIdentity(worktree)}
              worktree={worktree}
              repo={repo}
              isActive={activeWorktreeId === worktree.id}
              isActiveSurface={false}
              hideRepoBadge
              nativeDragEnabled={false}
              flushSurface
              contentIndent={0}
              affiliateListMode
            />
          ))}
        </div>
      )}
    </PageCard>
  )
}
