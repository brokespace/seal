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
  AUTO_CREATED_GRACE_MS,
  autoCreatedVerdict,
  type AutoCreatedFacts,
  type AutoCreatedVerdict
} from './auto-created-workspaces'
import type { WorkspaceCreation } from './workspace-creation'
import { isServedHere } from './workspace-link-catalog'

const SWEEP_DEBOUNCE_MS = 1_000
/** A project that could not go yet is looked at again, less and less often. */
const RETRY_MS = { first: 5_000, last: 300_000 }

type AutoCreatedRepo = Repo & { autoCreated: NonNullable<Repo['autoCreated']> }

export type AutoCreatedSweepDeps = {
  store: Pick<Store, 'getRepos' | 'updateRepo' | 'getAllWorktreeMeta' | 'getAllWorktreeMetaForHost'>
  creation: Pick<WorkspaceCreation, 'remove' | 'show'>
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
  private timer: { handle: ReturnType<typeof setTimeout>; at: number } | null = null
  private retryMs = RETRY_MS.first
  private sweeping = false

  constructor(private readonly deps: AutoCreatedSweepDeps) {}

  /** Sweeps in `ms`, or sooner when a sweep is already due before then. */
  schedule(ms = SWEEP_DEBOUNCE_MS): void {
    const at = (this.deps.now ?? Date.now)() + ms
    if (this.timer && this.timer.at <= at) {
      return
    }
    this.stop()
    const handle = setTimeout(() => {
      this.timer = null
      void this.run()
    }, ms)
    handle.unref?.()
    this.timer = { handle, at }
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer.handle)
      this.timer = null
    }
  }

  private autoCreated(): AutoCreatedRepo[] {
    return this.deps.store
      .getRepos()
      .filter((repo): repo is AutoCreatedRepo => !!repo.autoCreated && isServedHere(repo))
  }

  /** Comes back for the projects left without a session; none left, no timer. */
  private rearm(): void {
    const waiting = this.autoCreated().flatMap((repo) => this.emptySince.get(repo.id) ?? [])
    if (waiting.length === 0) {
      this.retryMs = RETRY_MS.first
      return
    }
    const graceLeft = Math.min(...waiting) + AUTO_CREATED_GRACE_MS - (this.deps.now ?? Date.now)()
    if (graceLeft > 0) {
      this.schedule(graceLeft)
      return
    }
    this.schedule(this.retryMs)
    this.retryMs = Math.min(this.retryMs * 2, RETRY_MS.last)
  }

  async run(): Promise<void> {
    const repos = this.autoCreated()
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
        await this.showIfStartedSinceHidden(repo)
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
      this.rearm()
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

  private runningSessions(repo: AutoCreatedRepo): LiveSession[] {
    return this.deps
      .sessions()
      .filter(
        (session) =>
          session.workspace &&
          getRepoIdFromWorktreeId(session.workspace.worktreeId) === repo.id &&
          session.machine.kind === 'local' &&
          !isPairedServerLiveSession(session) &&
          isActiveLiveSession(session)
      )
  }

  private async showIfStartedSinceHidden(repo: AutoCreatedRepo): Promise<void> {
    const { hiddenAt } = repo
    if (
      hiddenAt !== undefined &&
      this.runningSessions(repo).some((session) => (session.startedAt ?? 0) > hiddenAt)
    ) {
      try {
        await this.deps.creation.show(repo)
      } catch (error) {
        this.deps.log?.(`[live-sessions] showing auto-created project ${repo.path} failed`, error)
      }
    }
  }

  private verdict(repo: AutoCreatedRepo, inUse: ReadonlySet<string>): AutoCreatedVerdict {
    const now = (this.deps.now ?? Date.now)()
    const runningSessions = this.runningSessions(repo).length
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
