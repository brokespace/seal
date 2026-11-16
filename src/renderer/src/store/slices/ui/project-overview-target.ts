import { getRepoExecutionHostId } from '../../../../../shared/execution-host/execution-host'
import type { Repo } from '../../../../../shared/repository/repo-types'

/** The project an overview page shows. Host-scoped: two machines may register the same repo id. */
export type ProjectOverviewTarget = { repoId: string; hostId: string }

const STORAGE_KEY = 'seal.projectOverviewTarget'

export function projectOverviewTargetFor(
  repo: Pick<Repo, 'id' | 'connectionId' | 'executionHostId'>
): ProjectOverviewTarget {
  return { repoId: repo.id, hostId: getRepoExecutionHostId(repo) }
}

/** `activeView` is restored on launch; the page needs its project back with it. */
export function readSavedProjectOverviewTarget(): ProjectOverviewTarget | null {
  try {
    const saved: unknown = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? 'null')
    if (saved && typeof saved === 'object' && 'repoId' in saved && 'hostId' in saved) {
      const { repoId, hostId } = saved
      if (typeof repoId === 'string' && typeof hostId === 'string' && repoId && hostId) {
        return { repoId, hostId }
      }
    }
  } catch {
    // A corrupt entry is the same as none.
  }
  return null
}

export function saveProjectOverviewTarget(target: ProjectOverviewTarget): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(target))
  } catch {
    // Storage may be unavailable (private mode, quota); the page still opens.
  }
}
