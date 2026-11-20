import {
  getRepoExecutionHostId,
  getWorktreeExecutionHostId,
  LOCAL_EXECUTION_HOST_ID
} from '../../../shared/execution-host'
import { folderWorkspaceKey, parseWorkspaceKey } from '../../../shared/workspace-scope'
import { getProjectIdentityKey } from '../../../shared/project-host-setup-projection'
import type { Repo } from '../../../shared/repo-types'
import { getRepoIdFromWorktreeId } from '../../../shared/worktree/id'
import type { Store } from '../../persistence/loading-store/store'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { runtimeRepoIsRegistrationCandidate } from '../../runtime/workspaces/catalog/runtime-worktree-selection'
import type { LinkableWorkspace, SessionWorkspace } from './workspace-link-rules'

type HostRow = Pick<Repo, 'connectionId' | 'executionHostId'>

/** A row this process serves is on its own machine, whatever host id a paired client stamped on it. */
export function isServedHere(row: HostRow): boolean {
  return runtimeRepoIsRegistrationCandidate(row)
}

/** The host a row's sessions run on, as `liveSessionExecutionHost` names it from this process. */
function linkHostId(row: HostRow): string {
  return isServedHere(row) ? LOCAL_EXECUTION_HOST_ID : getRepoExecutionHostId(row)
}

/** Every workspace of this process's catalog a session can attach to. */
export async function readLinkableWorkspaces(
  runtime: Pick<OrcaRuntimeService, 'listManagedWorktrees'>,
  store: Pick<Store, 'getRepos' | 'getFolderWorkspaces' | 'getProjectGroups'>
): Promise<LinkableWorkspace[]> {
  const { worktrees } = await runtime.listManagedWorktrees(undefined, Number.MAX_SAFE_INTEGER)
  const repos = store.getRepos()
  const listed = worktrees.flatMap((worktree): LinkableWorkspace[] => {
    const owners = repos.filter((repo) => repo.id === worktree.repoId)
    const repo =
      owners.find((owner) => getRepoExecutionHostId(owner) === worktree.hostId) ?? owners[0]
    if (!repo) {
      return []
    }
    return [
      {
        worktreeId: worktree.id,
        projectKey: getProjectIdentityKey(repo),
        projectName: repo.displayName,
        hostId: isServedHere(repo)
          ? LOCAL_EXECUTION_HOST_ID
          : getWorktreeExecutionHostId(worktree, repo),
        path: worktree.path
      }
    ]
  })
  const groups = new Map(store.getProjectGroups().map((group) => [group.id, group.name]))
  const folders = store.getFolderWorkspaces().map((folder): LinkableWorkspace => {
    const projectName = groups.get(folder.projectGroupId)
    return {
      worktreeId: folderWorkspaceKey(folder.id),
      projectKey: folder.projectGroupId,
      ...(projectName ? { projectName } : {}),
      hostId: linkHostId(folder),
      path: folder.folderPath
    }
  })
  return [...listed, ...folders]
}

/** A workspace named by a tab that the listing does not show (a hidden worktree, one not scanned yet). */
export function storedSessionWorkspace(
  store: Pick<Store, 'getRepo' | 'getFolderWorkspaces'>,
  worktreeId: string
): SessionWorkspace | null {
  const scope = parseWorkspaceKey(worktreeId)
  if (scope?.type === 'folder') {
    const folder = store
      .getFolderWorkspaces()
      .find((candidate) => candidate.id === scope.folderWorkspaceId)
    return folder ? { worktreeId, projectKey: folder.projectGroupId } : null
  }
  const repo = store.getRepo(getRepoIdFromWorktreeId(worktreeId))
  return repo
    ? { worktreeId, projectKey: getProjectIdentityKey(repo), projectName: repo.displayName }
    : null
}

/** The last listing of linkable workspaces; read behind the callers, never in front of them. */
export class WorkspaceLinkCatalog {
  private workspaces: readonly LinkableWorkspace[] = []
  private listing = ''
  private readAt: number | null = null
  private reading: Promise<void> | null = null
  private stale = false

  constructor(
    private readonly deps: {
      read: () => Promise<LinkableWorkspace[]>
      onChange: () => void
      now?: () => number
      log?: (message: string, error?: unknown) => void
    }
  ) {}

  list(): readonly LinkableWorkspace[] {
    return this.workspaces
  }

  /** How old the listing is; never read counts as older than anything. */
  ageMs(): number {
    return this.readAt === null ? Infinity : (this.deps.now ?? Date.now)() - this.readAt
  }

  /** Resolves once a read that started after this call has finished. */
  refresh(): Promise<void> {
    if (this.reading) {
      this.stale = true
      return this.reading
    }
    this.reading = this.read().finally(() => {
      this.reading = null
    })
    return this.reading
  }

  private async read(): Promise<void> {
    do {
      this.stale = false
      try {
        const workspaces = await this.deps.read()
        this.readAt = (this.deps.now ?? Date.now)()
        const listing = JSON.stringify(workspaces)
        if (listing !== this.listing) {
          this.workspaces = workspaces
          this.listing = listing
          this.deps.onChange()
        }
      } catch (error) {
        this.deps.log?.('[live-sessions] workspace listing failed', error)
      }
    } while (this.stale)
  }
}
