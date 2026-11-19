import { toast } from 'sonner'
import { readSidebarSessionGroups } from '@/components/live-sessions/links/use-workspace-sessions'
import { isAutoProjectGroup } from '@/components/live-sessions/links/auto-project-listing'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { repoMatchesHostIdentity } from '@/store/repos/repo-host-identity'
import {
  getRepoExecutionHostId,
  LOCAL_EXECUTION_HOST_ID,
  parseExecutionHostId
} from '../../../../../../shared/execution-host'
import type { LiveSession } from '../../../../../../shared/live-sessions/live-session-types'
import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import { getProjectGroupHeaderKey } from '../../../../../../shared/sidebar-list/sections/group-keys'
import { openHeaderCreateComposer } from './header-create-workspace-target'

type AgentFolder = { path: string; kind: 'git' | 'folder'; runtimeEnvironmentId: string | null }

/**
 * Where a new agent of a project Seal made for sessions starts: the folder its newest running agent
 * started in, on that agent's machine. Null on an SSH machine, where Seal adds projects only
 * through that machine's own server.
 */
function agentFolder(session: LiveSession | undefined): AgentFolder | null {
  const path = session?.startCwd ?? session?.cwd
  if (!session || !path) {
    return null
  }
  const host = parseExecutionHostId(
    session.machine.executionHostId ??
      (session.machine.kind === 'local' ? LOCAL_EXECUTION_HOST_ID : null)
  )
  const kind = session.repository ? 'git' : 'folder'
  return host?.kind === 'local'
    ? { path, kind, runtimeEnvironmentId: null }
    : host?.kind === 'runtime'
      ? { path, kind, runtimeEnvironmentId: host.environmentId }
      : null
}

function newestAgentFolder(group: Pick<ProjectGroup, 'id'>): AgentFolder | null {
  return agentFolder(
    readSidebarSessionGroups().runningByHeader.get(getProjectGroupHeaderKey(group.id))
  )
}

/**
 * The + of a project Seal made for sessions: adds the folder its agents work in as that machine's
 * project, then opens New agent session there, as a project's own + does. While the project is not
 * permanent, the folder is one Seal made too, and goes once no agent is left in it.
 */
export async function startAgentInSessionProject(group: ProjectGroup): Promise<void> {
  const folder = newestAgentFolder(group)
  if (!folder) {
    toast.error(
      translate(
        'seal.autoProjects.noAgentFolder',
        'Start an agent in {{name}} on a machine with Seal first.',
        { name: group.name }
      )
    )
    return
  }
  const { addRepoPath, updateRepo } = useAppStore.getState()
  const known = new Set(useAppStore.getState().repos)
  const repo = await addRepoPath(folder.path, folder.kind, {
    runtimeEnvironmentId: folder.runtimeEnvironmentId,
    displayName: group.name
  })
  if (!repo) {
    return
  }
  const hostId = getRepoExecutionHostId(repo)
  const isNew = ![...known].some((row) => repoMatchesHostIdentity(row, repo.id, hostId))
  if (isNew && isAutoProjectGroup(group)) {
    await updateRepo(repo.id, { autoCreated: { displayName: repo.displayName } }, { hostId })
  }
  openHeaderCreateComposer(repo, { pinHost: true })
}
