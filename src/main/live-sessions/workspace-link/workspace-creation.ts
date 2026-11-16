import { normalizeRuntimePathForComparison } from '../../../shared/cross-platform-path'
import type { Repo } from '../../../shared/repo-types'
import type { Store } from '../../persistence/loading-store/store'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import type { WorkspacePlan } from './workspace-link-rules'

export type CreatableWorkspacePlan = Exclude<WorkspacePlan, { kind: 'unassigned' }>

export type WorkspaceCreationDeps = {
  runtime: Pick<OrcaRuntimeService, 'addRepo' | 'removeProject'>
  store: Pick<Store, 'getRepos' | 'updateRepo'>
  log?: (message: string, error?: unknown) => void
}

/** Makes projects on this process's own machine for sessions no workspace holds, and takes them away again. */
export class WorkspaceCreation {
  private readonly making = new Map<string, Promise<{ repo: Repo; created: boolean }>>()

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

  /** Forgets the project in Seal; its folder stays. */
  async remove(repo: Repo, reason: string): Promise<void> {
    await this.deps.runtime.removeProject(repo)
    this.deps.log?.(
      `[live-sessions] removed auto-created project "${repo.displayName}" at ${repo.path}: ${reason}`
    )
  }
}
