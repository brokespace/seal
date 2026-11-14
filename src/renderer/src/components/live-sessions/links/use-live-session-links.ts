import { useAppStore } from '@/store/index'
import type { AppState } from '@/store/types'
import { getIndexedWorktreeMap } from '@/store/slices/worktrees/listing/worktree-catalog-index'
import {
  selectFolderWorkspaces,
  selectWorktreesByRepo
} from '@/store/workspaces/catalog/workspace-record-fields'
import { getAiVaultResumeWorkspaceExecutionHostId } from '@/lib/agent-session/resume/history/ai-vault-resume-target'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { extendWorktreeIdByTabId } from '../../../../../shared/workspace-session/workspace-session-host-records'
import { folderWorkspaceKey } from '../../../../../shared/workspace-scope'
import { useLiveSessions } from '../live-session-registry-store'
import { liveSessionExecutionHost } from '../take-over/live-session-take-over'
import {
  linkLiveSessions,
  liveSessionBadges,
  type LinkableWorktree,
  type LiveSessionLink,
  type LiveSessionsBadge
} from './live-session-links'

export type LiveSessionLinks = {
  links: ReadonlyMap<string, LiveSessionLink>
  byWorktree: ReadonlyMap<string, LiveSessionsBadge>
  byProject: ReadonlyMap<string, LiveSessionsBadge>
}

function linkableWorktrees(state: AppState): LinkableWorktree[] {
  const projectNames = new Map(state.repos.map((repo) => [repo.id, repo.displayName]))
  const worktrees = [...getIndexedWorktreeMap(selectWorktreesByRepo(state) ?? {}).values()].map(
    (worktree) => {
      const project = projectNames.get(worktree.repoId)
      return {
        id: worktree.id,
        repoId: worktree.repoId,
        path: worktree.path,
        // "shop / checkout"; a primary checkout named for its branch alone says little.
        name:
          project && project !== worktree.displayName
            ? `${project} / ${worktree.displayName}`
            : worktree.displayName,
        hostId: getAiVaultResumeWorkspaceExecutionHostId(state, worktree.id)
      }
    }
  )
  // Folder workspaces hold sessions too; they have no git worktree behind them.
  const folders = (selectFolderWorkspaces(state) ?? []).map((folder) => ({
    id: folderWorkspaceKey(folder.id),
    repoId: folder.projectGroupId,
    path: folder.folderPath,
    name: folder.name,
    hostId: getAiVaultResumeWorkspaceExecutionHostId(state, folderWorkspaceKey(folder.id))
  }))
  return [...worktrees, ...folders]
}

type Inputs = readonly [
  readonly LiveSession[],
  AppState['repos'],
  ReturnType<typeof selectWorktreesByRepo>,
  ReturnType<typeof selectFolderWorkspaces>,
  AppState['tabsByWorktree'],
  AppState['unifiedTabsByWorktree']
]

let memo: { inputs: Inputs; value: LiveSessionLinks } | null = null

/** Many rows and badges ask in one render; the answer is worked out once per change. */
function linksFor(inputs: Inputs): LiveSessionLinks {
  if (memo && memo.inputs.every((input, index) => input === inputs[index])) {
    return memo.value
  }
  const state = useAppStore.getState()
  const [sessions, , , , tabsByWorktree, unifiedTabsByWorktree] = inputs
  const links = linkLiveSessions(
    sessions,
    linkableWorktrees(state),
    extendWorktreeIdByTabId(new Map(), { tabsByWorktree, unifiedTabsByWorktree }),
    (session) => liveSessionExecutionHost(session.machine)
  )
  memo = { inputs, value: { links, ...liveSessionBadges(sessions, links) } }
  return memo.value
}

/** Which workspace each live session runs in, and each workspace's and project's session badge. */
export function useLiveSessionLinks(): LiveSessionLinks {
  const { sessions } = useLiveSessions()
  const repos = useAppStore((state) => state.repos)
  const worktreesByRepo = useAppStore(selectWorktreesByRepo)
  const folderWorkspaces = useAppStore(selectFolderWorkspaces)
  const tabsByWorktree = useAppStore((state) => state.tabsByWorktree)
  const unifiedTabsByWorktree = useAppStore((state) => state.unifiedTabsByWorktree)
  return linksFor([
    sessions,
    repos,
    worktreesByRepo,
    folderWorkspaces,
    tabsByWorktree,
    unifiedTabsByWorktree
  ])
}
