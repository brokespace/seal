import { Copy, Monitor, Server } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { Button } from '@/components/ui/button'
import { PageCard } from '@/components/page-layout/PageCard'
import { useLocalMachineName } from '@/components/machines/model/use-local-machine-name'
import { branchName } from '@/lib/source-control/branches/branch-name'
import { getRepoExecutionHostId, LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import type { MachineSummary } from '../../../../shared/machines/machine-summaries'
import { isFolderRepo } from '../../../../shared/repo-kind'
import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { copyProjectPath, openProjectMachine } from './project-overview-actions'

function Fact({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right text-foreground">{children}</dd>
    </div>
  )
}

/** Where the project lives: each machine's checkout and path, then what kind of project it is. */
export function ProjectLocationCard({
  repo,
  registrations,
  machines,
  mainWorktree
}: {
  repo: Repo
  /** The project on every machine that has it; the page's own registration is among them. */
  registrations: readonly Repo[]
  machines: readonly MachineSummary[]
  mainWorktree: Worktree | null
}): React.JSX.Element {
  const t = useTranslate()
  const localName = useLocalMachineName()
  const isFolder = isFolderRepo(repo)
  const branch = mainWorktree && !isFolder ? branchName(mainWorktree.branch) : null
  return (
    <PageCard title={t('seal.projectOverview.location.title', 'Location')}>
      <ul className="divide-y divide-border">
        {registrations.map((registration) => {
          const hostId = getRepoExecutionHostId(registration)
          const machine = machines.find((item) => item.executionHostId === hostId)
          const isLocal = hostId === LOCAL_EXECUTION_HOST_ID
          const MachineIcon = isLocal ? Monitor : Server
          const name = isLocal ? localName : (machine?.label ?? hostId)
          return (
            <li key={hostId} data-project-overview-registration={hostId} className="px-3 py-2">
              <div className="flex items-center gap-1.5 text-xs">
                <MachineIcon className="size-3.5 shrink-0 text-muted-foreground" />
                {machine ? (
                  <Button
                    type="button"
                    variant="link"
                    size="inline"
                    className="min-w-0"
                    onClick={() => openProjectMachine(machine)}
                  >
                    <span className="truncate">{name}</span>
                  </Button>
                ) : (
                  <span className="min-w-0 truncate font-medium text-foreground">{name}</span>
                )}
                {machine && machine.status !== 'online' ? (
                  <span className="shrink-0 text-2xs text-muted-foreground">
                    {t('seal.projectOverview.location.notConnected', 'Not connected')}
                  </span>
                ) : null}
              </div>
              <div className="mt-0.5 flex items-start gap-1">
                <span className="min-w-0 flex-1 font-mono text-xs break-all text-muted-foreground select-text">
                  {registration.path}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t('seal.projectOverview.copyPath', 'Copy path')}
                  onClick={() => void copyProjectPath(registration.path)}
                >
                  <Copy />
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
      <dl className="space-y-1.5 border-t border-border px-3 py-2.5 text-xs">
        <Fact label={t('seal.projectOverview.location.kind', 'Kind')}>
          {isFolder
            ? t('seal.projectOverview.location.kindFolder', 'Folder')
            : t('seal.projectOverview.location.kindGit', 'Git repository')}
        </Fact>
        {branch ? (
          <Fact label={t('seal.projectOverview.location.branch', 'Branch')}>
            <span className="font-mono">{branch}</span>
          </Fact>
        ) : null}
        {repo.worktreeBaseRef ? (
          <Fact label={t('seal.projectOverview.location.baseBranch', 'New workspaces from')}>
            <span className="font-mono">{repo.worktreeBaseRef}</span>
          </Fact>
        ) : null}
        {repo.upstream ? (
          <Fact label={t('seal.projectOverview.location.forkOf', 'Fork of')}>
            {`${repo.upstream.owner}/${repo.upstream.repo}`}
          </Fact>
        ) : null}
      </dl>
    </PageCard>
  )
}
