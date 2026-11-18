import { normalizeRuntimePathForComparison } from '../../../shared/cross-platform-path'
import { getRepoExecutionHostId } from '../../../shared/execution-host'
import {
  isExplicitlyImportedExternalWorktreePath,
  mergeExternalWorktreeInboxPaths
} from '../../../shared/external-worktree-inbox'
import type { Repo } from '../../../shared/repo-types'
import type { Store } from '../../persistence/loading-store/store'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import type { WorkspacePlan } from './workspace-link-rules'

export type CreatableWorkspacePlan = Exclude<WorkspacePlan, { kind: 'unassigned' }>

export type WorkspaceCreationDeps = {
  runtime: Pick<OrcaRuntimeService, 'addRepo' | 'removeProject' | 'updateRepo'>
  store: Pick<Store, 'getRepos' | 'updateRepo'>
  log?: (message: string, error?: unknown) => void
}

/** Makes projects on this process's own machine for sessions no workspace holds, and takes them away again. */
export class WorkspaceCreation {
  private readonly making = new Map<string, Promise<{ repo: Repo; created: boolean }>>()
  private readonly importing = new Map<string, Promise<unknown>>()

  constructor(private readonly deps: WorkspaceCreationDeps) {}

  /** The project at the plan's folder; `created` when Seal had none there. */
  ensure(
    plan: CreatableWorkspacePlan,
    machineLabel: string
  ): Promise<{ repo: Repo; created: boolean }> {
    const key = normalizeRuntimePathForComparison(plan.path)
    const inFlight = this.making.get(key)
    if (inFlight) {
      return inFlight
    }
    const made = this.make(plan, machineLabel).finally(() => this.making.delete(key))
    this.making.set(key, made)
    return made
  }

  private async make(
    plan: CreatableWorkspacePlan,
    machineLabel: string
  ): Promise<{ repo: Repo; created: boolean }> {
    const { runtime, store } = this.deps
    const known = new Set(store.getRepos().map((repo) => repo.id))
    const repo = await runtime.addRepo(
      plan.path,
      plan.kind === 'checkout' ? 'git' : 'folder',
      undefined,
      plan.kind === 'home' ? `~ on ${machineLabel}` : undefined
    )
    if (known.has(repo.id)) {
      return { repo, created: false }
    }
    const marked = store.updateRepo(repo, { autoCreated: { displayName: repo.displayName } })
    this.deps.log?.(
      `[live-sessions] created project "${repo.displayName}" at ${repo.path} for a running session`
    )
    return { repo: marked ?? repo, created: true }
  }

  /** Lists a worktree of the project that Seal hides as made outside it, as importing it from the sidebar does. */
  importWorktree(repo: Repo, path: string): Promise<void> {
    // One at a time per project: each import writes the whole path list, so two at once lose one.
    const key = `${getRepoExecutionHostId(repo)}|${repo.id}`
    const imported = (this.importing.get(key) ?? Promise.resolve()).then(() =>
      this.listWorktree(repo, path)
    )
    const settled = imported.catch(() => undefined)
    this.importing.set(key, settled)
    void settled.then(() => {
      if (this.importing.get(key) === settled) {
        this.importing.delete(key)
      }
    })
    return imported
  }

  private async listWorktree(repo: Repo, path: string): Promise<void> {
    const hostId = getRepoExecutionHostId(repo)
    const current =
      this.deps.store
        .getRepos()
        .find((row) => row.id === repo.id && getRepoExecutionHostId(row) === hostId) ?? repo
    if (isExplicitlyImportedExternalWorktreePath(path, current)) {
      return
    }
    await this.deps.runtime.updateRepo(
      { selector: `id:${repo.id}`, hostId },
      {
        importedExternalWorktreePaths: mergeExternalWorktreeInboxPaths(
          current.importedExternalWorktreePaths,
          [path]
        ),
        externalWorktreeInboxBaselinePaths: mergeExternalWorktreeInboxPaths(
          current.externalWorktreeInboxBaselinePaths,
          [path]
        )
      }
    )
    this.deps.log?.(
      `[live-sessions] listed worktree ${path} of "${repo.displayName}" for a running session`
    )
  }

  /** Forgets the project in Seal; its folder stays. */
  async remove(repo: Repo, reason: string): Promise<void> {
    await this.deps.runtime.removeProject(repo)
    this.deps.log?.(
      `[live-sessions] removed auto-created project "${repo.displayName}" at ${repo.path}: ${reason}`
    )
  }
}
