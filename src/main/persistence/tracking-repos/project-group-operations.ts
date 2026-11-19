import type { ProfileSaveDomains } from '../profile-save-domains'
import { WORKSPACE_SESSION_DOMAINS } from '../workspace-session-domains'
import type { PersistedState } from '../../../shared/persisted-state-types'
import type {
  ProjectGroup,
  ProjectGroupMutation,
  ProjectGroupUpdate
} from '../../../shared/project-group-types'
import {
  createProjectGroup,
  getProjectGroupSubtreeIds,
  normalizeProjectGroupName
} from '../../../shared/project-groups'
import { getNextRootProjectOrder } from '../../../shared/root-project-order'
import { getRuntimePathBasename } from '../../../shared/cross-platform-path'
import { sessionProjectNameKey } from '../../../shared/live-sessions/live-session-project'
import type { LiveSessionProject } from '../../../shared/live-sessions/live-session-types'

/** A project a session names, with when its newest running agent started. */
export type SessionProjectRequest = LiveSessionProject & { startedAt?: number }
import { folderWorkspaceKey } from '../../../shared/workspace-scope'
import { removeWorkspaceSessionOwnersEverywhere } from '../restoring-sessions/session-owner-removal'

export type ProjectGroupMutationOperations = {
  state: PersistedState
  scheduleSave: (domains: ProfileSaveDomains) => void
  removeWorkspaceLineageForRemovedFolder: (folderWorkspaceId: string) => void
  pruneMobileClientTabSelections: (matchesWorktreeId: (worktreeId: string) => boolean) => void
}

export class ProjectGroupPersistenceOperations {
  constructor(private readonly operations: ProjectGroupMutationOperations) {}

  private get state(): PersistedState {
    return this.operations.state
  }

  private scheduleSave(domains: ProfileSaveDomains): void {
    this.operations.scheduleSave(domains)
  }

  private removeWorkspaceLineageForRemovedFolder(folderWorkspaceId: string): void {
    this.operations.removeWorkspaceLineageForRemovedFolder(folderWorkspaceId)
  }

  private pruneMobileClientTabSelections(matchesWorktreeId: (worktreeId: string) => boolean): void {
    this.operations.pruneMobileClientTabSelections(matchesWorktreeId)
  }

  getProjectGroups(): ProjectGroup[] {
    return [...(this.state.projectGroups ?? [])].sort(
      (left, right) => left.tabOrder - right.tabOrder || left.name.localeCompare(right.name)
    )
  }

  createProjectGroup(input: {
    name: string
    parentPath?: string | null
    connectionId?: string | null
    parentGroupId?: string | null
    createdFrom: ProjectGroup['createdFrom']
  }): ProjectGroup {
    let maxOrder = -1
    // Large persisted lists can exceed spread argument limits.
    for (const existingGroup of this.state.projectGroups ?? []) {
      maxOrder = Math.max(maxOrder, existingGroup.tabOrder)
    }
    const group = createProjectGroup({
      ...input,
      tabOrder: maxOrder + 1
    })
    const rootProjectOrder = !group.parentGroupId
      ? getNextRootProjectOrder(this.state.repos, this.state.projectGroups ?? [])
      : undefined
    if (rootProjectOrder !== undefined) {
      group.rootProjectOrder = rootProjectOrder
    }
    this.state.projectGroups = [...(this.state.projectGroups ?? []), group]
    this.scheduleSave(['projectGroups'])
    return group
  }

  updateProjectGroup(groupId: string, updates: ProjectGroupUpdate): ProjectGroup | null {
    const group = (this.state.projectGroups ?? []).find((entry) => entry.id === groupId)
    if (!group) {
      return null
    }
    this.applyGroupUpdate(group, updates)
    this.scheduleSave(['projectGroups'])
    return group
  }

  updateProjectGroups(mutations: readonly ProjectGroupMutation[]): ProjectGroup[] | null {
    const byId = new Map((this.state.projectGroups ?? []).map((group) => [group.id, group]))
    if (mutations.some(({ groupId }) => !byId.has(groupId))) {
      return null
    }
    const updated = mutations.map(({ groupId, updates }) => {
      const group = byId.get(groupId)!
      this.applyGroupUpdate(group, updates)
      return group
    })
    if (updated.length > 0) {
      this.scheduleSave(['projectGroups'])
    }
    return updated
  }

  private applyGroupUpdate(group: ProjectGroup, updates: ProjectGroupUpdate): void {
    if (updates.name !== undefined) {
      group.name = normalizeProjectGroupName(updates.name, group.name)
    }
    if (updates.isCollapsed !== undefined) {
      group.isCollapsed = updates.isCollapsed
    }
    if (updates.tabOrder !== undefined && Number.isFinite(updates.tabOrder)) {
      group.tabOrder = updates.tabOrder
    }
    if (updates.rootProjectOrder === null) {
      delete group.rootProjectOrder
    } else if (
      updates.rootProjectOrder !== undefined &&
      Number.isFinite(updates.rootProjectOrder)
    ) {
      group.rootProjectOrder = updates.rootProjectOrder
    }
    if (updates.color !== undefined) {
      group.color = typeof updates.color === 'string' ? updates.color : null
    }
    if (updates.hookSettings !== undefined) {
      group.hookSettings = updates.hookSettings
    }
    if (updates.hiddenAt === null) {
      delete group.hiddenAt
    } else if (updates.hiddenAt !== undefined && Number.isFinite(updates.hiddenAt)) {
      group.hiddenAt = updates.hiddenAt
    }
    if (updates.keptAt !== undefined && Number.isFinite(updates.keptAt) && group.sessionProject) {
      group.keptAt = updates.keptAt
    }
    group.updatedAt = Date.now()
  }

  /**
   * Makes a project for each session project nothing is named for yet: no group, no repo, and,
   * unless the user asked for it by name (`explicit`), none they removed since its newest agent
   * started. Returns those made.
   */
  ensureSessionProjectGroups(
    projects: readonly SessionProjectRequest[],
    explicit: boolean
  ): ProjectGroup[] {
    const known = new Set<string>()
    for (const group of this.state.projectGroups ?? []) {
      known.add(sessionProjectNameKey(group.name))
      if (group.sessionProject) {
        known.add(sessionProjectNameKey(group.sessionProject.name))
        known.add(group.sessionProject.key)
      }
    }
    for (const repo of this.state.repos) {
      known.add(sessionProjectNameKey(repo.displayName))
      known.add(sessionProjectNameKey(getRuntimePathBasename(repo.path)))
    }
    const dismissed = { ...this.state.dismissedSessionProjects }
    const created: ProjectGroup[] = []
    for (const project of projects) {
      const nameKey = sessionProjectNameKey(project.name)
      if (!nameKey || known.has(nameKey) || known.has(project.key)) {
        continue
      }
      const dismissedAt = dismissed[nameKey]
      if (dismissedAt !== undefined) {
        if (!explicit && (project.startedAt ?? 0) <= dismissedAt) {
          continue
        }
        delete dismissed[nameKey]
        this.state.dismissedSessionProjects = dismissed
        this.scheduleSave(['dismissedSessionProjects'])
      }
      const group = this.createProjectGroup({ name: project.name, createdFrom: 'manual' })
      group.sessionProject = { key: project.key, name: project.name }
      this.scheduleSave(['projectGroups'])
      known.add(nameKey)
      known.add(project.key)
      created.push(group)
    }
    return created
  }

  deleteProjectGroup(groupId: string): boolean {
    const before = this.state.projectGroups?.length ?? 0
    const deletedGroupIds = getProjectGroupSubtreeIds(this.state.projectGroups ?? [], groupId)
    this.dismissSessionProjects(deletedGroupIds)
    this.state.projectGroups = (this.state.projectGroups ?? []).filter(
      (group) => !deletedGroupIds.has(group.id)
    )
    if ((this.state.projectGroups?.length ?? 0) === before) {
      return false
    }
    // Sidebar grouping does not own repos; ungroup them rather than delete them.
    this.state.repos = this.state.repos.map((repo) =>
      repo.projectGroupId && deletedGroupIds.has(repo.projectGroupId)
        ? { ...repo, projectGroupId: null }
        : repo
    )
    const removedFolderWorkspaceKeys = new Set<string>()
    for (const workspace of this.state.folderWorkspaces ?? []) {
      if (deletedGroupIds.has(workspace.projectGroupId)) {
        removedFolderWorkspaceKeys.add(folderWorkspaceKey(workspace.id))
        this.removeWorkspaceLineageForRemovedFolder(workspace.id)
      }
    }
    // Remove all partition copies or folder layouts could resurrect on load.
    removeWorkspaceSessionOwnersEverywhere(this.state, removedFolderWorkspaceKeys)
    this.state.folderWorkspaces = (this.state.folderWorkspaces ?? []).filter(
      (workspace) => !deletedGroupIds.has(workspace.projectGroupId)
    )
    this.pruneMobileClientTabSelections((worktreeId) => removedFolderWorkspaceKeys.has(worktreeId))
    this.scheduleSave([
      'projectGroups',
      'repos',
      'folderWorkspaces',
      'workspaceLineageByChildKey',
      'crossStoreLineageByChildKey',
      ...WORKSPACE_SESSION_DOMAINS,
      'mobileClientTabSelectionsByDeviceId'
    ])
    return true
  }

  /**
   * A project made for sessions that the user removes stays away until an agent starts in it again;
   * one they made permanent stays removed, as any project they made does.
   */
  private dismissSessionProjects(groupIds: ReadonlySet<string>): void {
    const now = Date.now()
    const dismissed = { ...this.state.dismissedSessionProjects }
    let changed = false
    for (const group of this.state.projectGroups ?? []) {
      if (!groupIds.has(group.id) || !group.sessionProject) {
        continue
      }
      const until = group.keptAt === undefined ? now : Number.MAX_SAFE_INTEGER
      for (const name of [group.sessionProject.name, group.name]) {
        dismissed[sessionProjectNameKey(name)] = until
      }
      changed = true
    }
    if (changed) {
      this.state.dismissedSessionProjects = dismissed
      this.scheduleSave(['dismissedSessionProjects'])
    }
  }
}

/** Removals saved as a bare list of names predate their times: an agent started since brings each back. */
export function normalizeDismissedSessionProjects(
  value: unknown
): Pick<PersistedState, 'dismissedSessionProjects'> {
  const entries = Array.isArray(value)
    ? value.filter((name): name is string => typeof name === 'string').map((name) => [name, 0])
    : value && typeof value === 'object'
      ? Object.entries(value).filter(
          (entry): entry is [string, number] =>
            typeof entry[1] === 'number' && Number.isFinite(entry[1])
        )
      : []
  return entries.length > 0 ? { dismissedSessionProjects: Object.fromEntries(entries) } : {}
}
