import { isPairedServerLiveSession } from '../../../shared/live-sessions/live-session-paired-server'
import { isActiveLiveSession } from '../../../shared/live-sessions/live-session-status'
import type { LiveSession } from '../../../shared/live-sessions/live-session-types'
import type { Repo } from '../../../shared/repo-types'
import {
  FOLDER_WORKSPACE_INSTANCE_SEPARATOR,
  getRepoIdFromWorktreeId
} from '../../../shared/worktree/id'
import type { WorktreeMeta } from '../../../shared/worktree/meta-types'
import { readAllWorktreeMetaForRepo } from '../../persistence/host-qualified-worktree-meta'
import type { Store } from '../../persistence/loading-store/store'
import {
  autoCreatedVerdict,
  type AutoCreatedFacts,
  type AutoCreatedVerdict
} from './auto-created-workspaces'
import type { WorkspaceCreation } from './workspace-creation'
import { isServedHere } from './workspace-link-catalog'

const SWEEP_DEBOUNCE_MS = 1_000

type AutoCreatedRepo = Repo & { autoCreated: NonNullable<Repo['autoCreated']> }

export type AutoCreatedSweepDeps = {
  store: Pick<Store, 'getRepos' | 'updateRepo' | 'getAllWorktreeMeta' | 'getAllWorktreeMetaForHost'>
  creation: Pick<WorkspaceCreation, 'remove'>
  /** Published sessions, each with the workspace it was linked to. */
  sessions: () => readonly LiveSession[]
  /** This machine's sessions and workspaces have both been listed, so a missing session has left. */
  machineRead: () => boolean
  inUse: () => ReadonlySet<string>
  /** Workspaces with a terminal, tab or no tab; asked only before a removal. */
  terminalWorkspaces: () => Promise<ReadonlySet<string>>
  /** A project went away: the listing and the sessions linked to it are out of date. */
  onRemoved: () => Promise<void>
  now?: () => number
  log?: (message: string, error?: unknown) => void
}

function workspaceFacts(
  worktreeId: string,
  meta: WorktreeMeta | undefined,
  inUse: ReadonlySet<string>
): AutoCreatedFacts['workspaces'][number] {
  return {
    pinned: meta?.isPinned === true,
    renamed: meta?.displayNameIsPinned === true,
    hasComment: !!meta?.comment?.trim(),
    createdInSeal:
      meta?.orcaCreatedAt !== undefined ||
      meta?.orcaCreationSource !== undefined ||
      worktreeId.includes(FOLDER_WORKSPACE_INSTANCE_SEPARATOR),
    inUse: inUse.has(worktreeId)
  }
}

/** Takes away the projects Seal made for sessions once those have left, and keeps the ones the user took up. */
export class AutoCreatedSweep {
  private readonly emptySince = new Map<string, number>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private sweeping = false

  constructor(private readonly deps: AutoCreatedSweepDeps) {}

  schedule(): void {
    if (this.timer) {
      return
    }
    this.timer = setTimeout(() => {
      this.timer = null
      void this.run()
    }, SWEEP_DEBOUNCE_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  async run(): Promise<void> {
    const repos = this.deps.store
      .getRepos()
      .filter((repo): repo is AutoCreatedRepo => !!repo.autoCreated && isServedHere(repo))
    for (const repoId of this.emptySince.keys()) {
      if (!repos.some((repo) => repo.id === repoId)) {
        this.emptySince.delete(repoId)
      }
    }
    if (this.sweeping || repos.length === 0) {
      return
    }
    this.sweeping = true
    try {
      let removed = false
      let inUse = this.deps.inUse()
      let terminalsSeen = false
      for (const repo of repos) {
        let verdict = this.verdict(repo, inUse)
        if (verdict === 'remove' && !terminalsSeen) {
          // Removal stops the project's terminals, so one no tab shows must be seen first.
          inUse = new Set([...inUse, ...(await this.deps.terminalWorkspaces())])
          terminalsSeen = true
          verdict = this.verdict(repo, inUse)
        }
        if (verdict === 'adopt') {
          this.deps.store.updateRepo(repo, { autoCreated: undefined })
        } else if (verdict === 'remove') {
          removed = (await this.remove(repo)) || removed
        }
      }
      if (removed) {
        await this.deps.onRemoved()
      }
    } catch (error) {
      this.deps.log?.('[live-sessions] sweep of auto-created projects failed', error)
    } finally {
      this.sweeping = false
    }
  }

  private async remove(repo: AutoCreatedRepo): Promise<boolean> {
    try {
      await this.deps.creation.remove(repo, 'its last session has left')
      this.emptySince.delete(repo.id)
      return true
    } catch (error) {
      this.deps.log?.(`[live-sessions] removing auto-created project ${repo.path} failed`, error)
      return false
    }
  }

  private runningSessions(repo: AutoCreatedRepo): number {
    return this.deps
      .sessions()
      .filter(
        (session) =>
          session.workspace &&
          getRepoIdFromWorktreeId(session.workspace.worktreeId) === repo.id &&
          session.machine.kind === 'local' &&
          !isPairedServerLiveSession(session) &&
          isActiveLiveSession(session)
      ).length
  }

  private verdict(repo: AutoCreatedRepo, inUse: ReadonlySet<string>): AutoCreatedVerdict {
    const now = (this.deps.now ?? Date.now)()
    const runningSessions = this.runningSessions(repo)
    if (runningSessions > 0) {
      this.emptySince.delete(repo.id)
    } else if (!this.emptySince.has(repo.id)) {
      this.emptySince.set(repo.id, now)
    }
    const ofRepo = (worktreeId: string): boolean => getRepoIdFromWorktreeId(worktreeId) === repo.id
    const metas = readAllWorktreeMetaForRepo(this.deps.store, repo)
    const worktreeIds = new Set([
      ...Object.keys(metas).filter(ofRepo),
      ...[...inUse].filter(ofRepo)
    ])
    const facts: AutoCreatedFacts = {
      givenName: repo.autoCreated.displayName,
      displayName: repo.displayName,
      workspaces: [...worktreeIds].map((worktreeId) =>
        workspaceFacts(worktreeId, metas[worktreeId], inUse)
      ),
      runningSessions,
      machineRead: this.deps.machineRead(),
      emptySince: this.emptySince.get(repo.id) ?? null
    }
    return autoCreatedVerdict(facts, now)
  }
}
