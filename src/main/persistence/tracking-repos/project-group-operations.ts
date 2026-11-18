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
    group.updatedAt = Date.now()
  }

  /**
   * Makes a project for each session project nothing is named for yet: no group, no repo, and,
   * unless the user asked for it by name (`explicit`), none they removed before. Returns those made.
   */
  ensureSessionProjectGroups(
    projects: readonly LiveSessionProject[],
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
    const dismissed = new Set(this.state.dismissedSessionProjects ?? [])
    const created: ProjectGroup[] = []
    for (const project of projects) {
      const nameKey = sessionProjectNameKey(project.name)
      if (!nameKey || known.has(nameKey) || known.has(project.key)) {
        continue
      }
      if (dismissed.has(nameKey)) {
        if (!explicit) {
          continue
        }
        dismissed.delete(nameKey)
        this.state.dismissedSessionProjects = [...dismissed]
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

  /** A project made for sessions that the user removes stays removed: its sessions list with no project. */
  private dismissSessionProjects(groupIds: ReadonlySet<string>): void {
    const names = (this.state.projectGroups ?? []).flatMap((group) =>
      groupIds.has(group.id) && group.sessionProject
        ? [sessionProjectNameKey(group.sessionProject.name), sessionProjectNameKey(group.name)]
        : []
    )
    if (names.length === 0) {
      return
    }
    this.state.dismissedSessionProjects = [
      ...new Set([...(this.state.dismissedSessionProjects ?? []), ...names])
    ]
    this.scheduleSave(['dismissedSessionProjects'])
  }
}
