import type { AppState } from '@/store/types'
import { getRuntimePathBasename } from '../../../../../shared/cross-platform-path'
import { sessionProjectNameKey } from '../../../../../shared/live-sessions/live-session-project'
import type { LiveSessionProject } from '../../../../../shared/live-sessions/live-session-types'
import {
  getGitRemoteProviderIdentity,
  getProjectIdForProviderIdentity,
  getProjectIdentityKey
} from '../../../../../shared/project-host-setup-projection'
import type { ProjectHostSetupProjection } from '../../../../../shared/project-host-setup-projection'
import {
  buildProjectGroupingIndex,
  getProjectGroupingForRepo
} from '../../../../../shared/project-section-grouping'
import { getProjectGroupHeaderKey } from '../../../../../shared/sidebar-list/sections/group-keys'

/** A project the sidebar has a header for: a repository's project or a project group. */
export type SidebarSessionProject = {
  headerKey: string
  /** What a session moved to it stores. */
  key: string
  name: string
}

export type SessionProjectCatalog = {
  projects: readonly SidebarSessionProject[]
  /** The project a session's project names: by its key, else by its name in any letter case. */
  find: (project: LiveSessionProject) => SidebarSessionProject | undefined
  /** The project of a workspace, by its repo's or its group's id. */
  ofWorkspace: (repoId: string) => SidebarSessionProject | undefined
}

export type SessionProjectCatalogInputs = Pick<AppState, 'repos' | 'projectGroups'> & {
  projection: ProjectHostSetupProjection
}

export function buildSessionProjectCatalog({
  repos,
  projectGroups,
  projection
}: SessionProjectCatalogInputs): SessionProjectCatalog {
  const byHeader = new Map<string, SidebarSessionProject>()
  const byKey = new Map<string, SidebarSessionProject>()
  const byName = new Map<string, SidebarSessionProject>()
  const byWorkspace = new Map<string, SidebarSessionProject>()
  // The first project to claim a key or a name keeps it: repositories come before groups.
  const claim = (
    index: Map<string, SidebarSessionProject>,
    key: string | null | undefined,
    project: SidebarSessionProject
  ): void => {
    if (key && !index.has(key)) {
      index.set(key, project)
    }
  }
  const repoMap = new Map(repos.map((repo) => [repo.id, repo]))
  // The sidebar's own header for each repo, so a session lands under the header its workspaces have.
  const projectIndex = buildProjectGroupingIndex({
    projects: projection.projects,
    projectHostSetups: projection.setups
  })
  for (const repo of repos) {
    const header = getProjectGroupingForRepo(repo.id, repoMap, projectIndex)
    const identityKey = getProjectIdentityKey(repo)
    let project = byHeader.get(header.key)
    if (!project) {
      project = {
        headerKey: header.key,
        key: header.projectId ?? identityKey,
        name: header.label
      }
      byHeader.set(header.key, project)
    }
    byWorkspace.set(repo.id, project)
    claim(byKey, project.key, project)
    claim(byKey, identityKey, project)
    // A fork's project is keyed by its upstream; a session's folder only knows its own remotes.
    const remote = getGitRemoteProviderIdentity(repo)
    claim(byKey, remote && getProjectIdForProviderIdentity(remote), project)
    for (const name of [header.label, repo.displayName, getRuntimePathBasename(repo.path)]) {
      claim(byName, sessionProjectNameKey(name), project)
    }
  }
  for (const group of projectGroups ?? []) {
    const headerKey = getProjectGroupHeaderKey(group.id)
    if (byHeader.has(headerKey)) {
      continue
    }
    const project = { headerKey, key: group.id, name: group.name }
    byHeader.set(headerKey, project)
    byWorkspace.set(group.id, project)
    claim(byKey, group.id, project)
    claim(byName, sessionProjectNameKey(group.name), project)
  }
  return {
    projects: [...byHeader.values()],
    find: (project) => byKey.get(project.key) ?? byName.get(sessionProjectNameKey(project.name)),
    ofWorkspace: (repoId) => byWorkspace.get(repoId)
  }
}
