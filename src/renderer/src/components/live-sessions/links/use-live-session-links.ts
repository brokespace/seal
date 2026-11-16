import { useAppStore } from '@/store/index'
import type { AppState } from '@/store/types'
import {
  selectFolderWorkspaces,
  selectWorktreesByRepo
} from '@/store/workspaces/catalog/workspace-record-fields'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { useLiveSessions } from '../live-session-registry-store'
import {
  projectSessionBadges,
  workspaceLinkFinder,
  type LiveSessionLink,
  type LiveSessionsBadge
} from './live-session-links'

export type LiveSessionLinks = {
  links: ReadonlyMap<string, LiveSessionLink>
  byProject: ReadonlyMap<string, LiveSessionsBadge>
}

type Inputs = readonly [
  readonly LiveSession[],
  AppState['repos'],
  AppState['worktreesByRepo'],
  AppState['folderWorkspaces']
]

let memo: { inputs: Inputs; value: LiveSessionLinks } | null = null

/** Many rows and badges ask in one render; the answer is worked out once per change. */
function linksFor(inputs: Inputs): LiveSessionLinks {
  if (memo && memo.inputs.every((input, index) => input === inputs[index])) {
    return memo.value
  }
  const [sessions, repos, worktreesByRepo, folderWorkspaces] = inputs
  const find = workspaceLinkFinder({ repos, worktreesByRepo, folderWorkspaces })
  const links = new Map<string, LiveSessionLink>()
  for (const session of sessions) {
    // Unlinked until the catalog lists its workspace, so it shows as unassigned, never nowhere.
    const link = session.workspace && find(session.workspace.worktreeId)
    if (link) {
      links.set(session.id, link)
    }
  }
  memo = { inputs, value: { links, byProject: projectSessionBadges(sessions, links) } }
  return memo.value
}

/** The workspace the registry attached each live session to, and each project's session badge. */
export function useLiveSessionLinks(): LiveSessionLinks {
  const { sessions } = useLiveSessions()
  const repos = useAppStore((state) => state.repos)
  const worktreesByRepo = useAppStore(selectWorktreesByRepo)
  const folderWorkspaces = useAppStore(selectFolderWorkspaces)
  return linksFor([sessions, repos, worktreesByRepo, folderWorkspaces])
}
