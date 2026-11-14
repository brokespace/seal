import { GitPullRequest } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import type { HomeWorkspace } from './home-overview-model'
import { HomeOverviewEmpty, HomeOverviewPanel, HomeOverviewRowButton } from './HomeOverviewPanel'
import { countHomeWorkspaces } from './orca-home-workspace-mapping'

const MAX_REVIEW_ROWS = 6

function Stat({ value, label }: { value: number; label: string }): React.JSX.Element {
  return (
    <div className="min-w-0">
      <div className="text-lg leading-tight font-semibold text-foreground tabular-nums">
        {value}
      </div>
      <div className="truncate text-2xs text-muted-foreground">{label}</div>
    </div>
  )
}

export function HomeWorkspacesPanel({
  workspaces,
  onOpen
}: {
  workspaces: readonly HomeWorkspace[]
  onOpen: (workspace: HomeWorkspace) => void
}): React.JSX.Element {
  const t = useTranslate()
  const counts = countHomeWorkspaces(workspaces)
  const reviews = workspaces
    .filter(
      (workspace) => workspace.review?.state === 'open' || workspace.review?.state === 'draft'
    )
    .slice(0, MAX_REVIEW_ROWS)
  return (
    <HomeOverviewPanel title={t('home.overview.workspaces.title', 'Worktrees & PRs')}>
      {workspaces.length === 0 ? (
        <HomeOverviewEmpty>
          {t('home.overview.workspaces.empty', 'No active worktrees.')}
        </HomeOverviewEmpty>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 px-3 py-2.5">
            <Stat
              value={counts.workspaces}
              label={t('home.overview.workspaces.active', 'Active')}
            />
            <Stat
              value={counts.openReviews}
              label={t('home.overview.workspaces.open', 'Open PRs')}
            />
            <Stat
              value={counts.draftReviews}
              label={t('home.overview.workspaces.draft', 'Drafts')}
            />
          </div>
          {reviews.length > 0 ? (
            <ul className="border-t border-border px-1.5 py-1.5">
              {reviews.map((workspace) => (
                <li key={workspace.id}>
                  <HomeOverviewRowButton
                    onClick={() => onOpen(workspace)}
                    className="px-1.5 py-1 text-xs"
                  >
                    <GitPullRequest className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-foreground">
                      {workspace.name}
                    </span>
                    <span className="shrink-0 text-2xs text-muted-foreground tabular-nums">
                      #{workspace.review?.number}
                      {workspace.review?.state === 'draft'
                        ? ` · ${t('home.overview.workspaces.draftLabel', 'draft')}`
                        : ''}
                    </span>
                  </HomeOverviewRowButton>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </HomeOverviewPanel>
  )
}
