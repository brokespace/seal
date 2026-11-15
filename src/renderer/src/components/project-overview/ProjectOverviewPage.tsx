import { useMemo } from 'react'
import { FolderSearch } from 'lucide-react'
import { useAppStore } from '@/store'
import type { ProjectOverviewTarget } from '@/store/slices/ui/project-overview-target'
import { useTranslate } from '@/i18n/use-translate'
import { Button } from '@/components/ui/button'
import { PageCardGrid } from '@/components/page-layout/PageCard'
import {
  PageHeader,
  PageLayout,
  PageScrollContent,
  PageTitle
} from '@/components/page-layout/PageLayout'
import { RepoIconGlyph } from '@/components/repo/repo-icon'
import { RepoForkIndicator } from '@/components/repo/repo-fork-indicator'
import { useHomeNow } from '@/components/home-overview/home-overview-presentation'
import { useLiveSessions } from '@/components/live-sessions/live-session-registry-store'
import { useLiveSessionLinks } from '@/components/live-sessions/links/use-live-session-links'
import { useLiveSessionCountsLine } from '@/components/live-sessions/status/use-live-session-counts-line'
import { useLocalMachineName } from '@/components/machines/model/use-local-machine-name'
import { useMachinesInventory } from '@/components/machines/model/use-machines-inventory'
import { useMobilePageEscape } from '@/components/mobile/use-mobile-page-escape'
import { agentConfigAvailable } from '@/components/agent-config/model/agent-config-client'
import { getRepoExecutionHostId } from '../../../../shared/execution-host'
import { isActiveLiveSession } from '../../../../shared/live-sessions/live-session-status'
import { isGitRepoKind } from '../../../../shared/repo-kind'
import type { Repo } from '../../../../shared/repo-types'
import {
  projectLiveSessions,
  projectRegistrations,
  resolveProjectOverviewRepo
} from './project-overview-model'
import { ProjectAgentConfigCard } from './ProjectAgentConfigCard'
import { ProjectAgentsCard } from './ProjectAgentsCard'
import { ProjectChangesCard } from './ProjectChangesCard'
import { ProjectCommitsCard } from './ProjectCommitsCard'
import { ProjectLocationCard } from './ProjectLocationCard'
import { ProjectOverviewHeaderActions } from './ProjectOverviewHeaderActions'
import { ProjectPullRequestsCard } from './ProjectPullRequestsCard'
import { ProjectReadmeCard } from './ProjectReadmeCard'
import { ProjectUsageCard } from './ProjectUsageCard'
import { ProjectWorkspacesCard } from './ProjectWorkspacesCard'
import { useProjectWorktrees } from './use-project-worktrees'

function ProjectOverview({ repo }: { repo: Repo }): React.JSX.Element {
  const now = useHomeNow()
  const repos = useAppStore((s) => s.repos)
  const { sessions: allSessions } = useLiveSessions()
  const { links } = useLiveSessionLinks()
  const { machines } = useMachinesInventory(useLocalMachineName())

  const hostId = getRepoExecutionHostId(repo)
  const machine = machines.find((item) => item.executionHostId === hostId) ?? null
  const registrations = useMemo(() => projectRegistrations(repos, repo.id), [repos, repo.id])
  const worktrees = useProjectWorktrees(repo)
  const mainWorktree = worktrees.find((worktree) => worktree.isMainWorktree) ?? worktrees[0] ?? null
  const sessions = useMemo(
    () => projectLiveSessions(allSessions, links, repo.id),
    [allSessions, links, repo.id]
  )
  const running = useMemo(() => sessions.filter(isActiveLiveSession), [sessions])
  // Home's own header line, so a project reads the way the whole fleet does.
  const summary = useLiveSessionCountsLine(running)
  const isGit = isGitRepoKind(repo)

  return (
    <PageLayout data-project-overview={repo.id}>
      <PageHeader
        // The actions drop under the name once a narrow page leaves the name no room beside them.
        className="@container/project-header flex-wrap gap-y-2"
        title={
          <div className="flex min-w-40 flex-1 items-center gap-2">
            <RepoIconGlyph
              repoIcon={repo.repoIcon}
              color={repo.badgeColor}
              className="size-5 shrink-0"
              iconClassName="size-4"
            />
            <PageTitle className="flex-initial">{repo.displayName}</PageTitle>
            <RepoForkIndicator upstream={repo.upstream} />
            {/* The Agents card says the same below, so a narrow page gives the row to the name. */}
            <p className="hidden shrink-0 text-xs text-muted-foreground tabular-nums @min-[60rem]/project-header:block">
              {summary}
            </p>
          </div>
        }
      >
        <ProjectOverviewHeaderActions repo={repo} machine={machine} mainWorktree={mainWorktree} />
      </PageHeader>
      <PageScrollContent>
        <div className="@container/overview flex min-w-0 flex-col gap-(--page-section-gap)">
          <div className="grid grid-cols-1 items-start gap-(--page-section-gap) @min-[56rem]/overview:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="flex min-w-0 flex-col gap-(--page-section-gap)">
              <ProjectAgentsCard repo={repo} sessions={sessions} now={now} />
              <ProjectWorkspacesCard repo={repo} worktrees={worktrees} />
              {agentConfigAvailable() ? <ProjectAgentConfigCard repo={repo} /> : null}
              <ProjectReadmeCard repo={repo} machine={machine} mainWorktree={mainWorktree} />
            </div>
            <PageCardGrid>
              <ProjectLocationCard
                repo={repo}
                registrations={registrations}
                machines={machines}
                mainWorktree={mainWorktree}
              />
              {isGit ? <ProjectChangesCard worktrees={worktrees} /> : null}
              {isGit ? <ProjectPullRequestsCard repo={repo} worktrees={worktrees} /> : null}
              {isGit ? <ProjectCommitsCard worktree={mainWorktree} now={now} /> : null}
              <ProjectUsageCard repo={repo} />
            </PageCardGrid>
          </div>
        </div>
      </PageScrollContent>
    </PageLayout>
  )
}

/** The project is gone (removed, or its machine forgotten): say so and offer the way back. */
function ProjectOverviewMissing({ onClose }: { onClose: () => void }): React.JSX.Element {
  const t = useTranslate()
  return (
    <PageLayout data-project-overview-missing>
      <PageHeader title={t('seal.projectOverview.title', 'Project overview')} />
      <PageScrollContent>
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <FolderSearch className="size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {t(
              'seal.projectOverview.missing',
              'This project is no longer in Seal. Pick a project in the sidebar to see its overview.'
            )}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            {t('seal.projectOverview.back', 'Go back')}
          </Button>
        </div>
      </PageScrollContent>
    </PageLayout>
  )
}

/** A project's overview without the page around it: the page draws it, and so does a split-view pane. */
export function ProjectOverviewBody({
  target,
  onClose
}: {
  target: ProjectOverviewTarget | null
  onClose: () => void
}): React.JSX.Element {
  const repos = useAppStore((s) => s.repos)
  const repo = useMemo(() => resolveProjectOverviewRepo(repos, target), [repos, target])
  return repo ? (
    // A different project starts every card over instead of showing the last one's data.
    <ProjectOverview key={`${getRepoExecutionHostId(repo)}\n${repo.id}`} repo={repo} />
  ) : (
    <ProjectOverviewMissing onClose={onClose} />
  )
}

/** One project at a glance: where it lives, its code, its agents and how they are configured. */
export default function ProjectOverviewPage(): React.JSX.Element {
  const target = useAppStore((s) => s.projectOverviewTarget)
  const close = useAppStore((s) => s.closeProjectOverview)
  useMobilePageEscape(close)
  return <ProjectOverviewBody target={target} onClose={close} />
}
