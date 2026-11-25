import type { WorktreeLineageSource } from './worktree-lineage-range'
import type { WorktreeOccurrence } from '../worktree-occurrence-plan'
import type { FolderWorkspace } from '../folder-workspaces/folder-workspace-types'
import type { ProjectGroup } from '../project-group-types'
import type { Repo } from '../repo-types'
import type { DetectedWorktree, WorkspaceStatus, Worktree } from '../worktree/types'
import type { ExecutionHostId } from '../execution-host'
import type { PRGroupKey } from '../workspace-view/workspace-pr-groups'

export type WorktreeGroupBy = 'none' | 'workspace-status' | 'repo' | 'pr-status'
/** A row's own registration of its repo; the same repo id can be registered on several hosts. */
export type RepoOfWorktree = (worktree: Worktree) => Repo | undefined
export type PinnedWorktreeDisplayPolicy = 'single-location' | 'duplicate-in-groups'

export function getPinnedWorktreeDisplayPolicy(
  settings?: { showPinnedWorktreesInGroups?: boolean } | null
): PinnedWorktreeDisplayPolicy {
  return settings?.showPinnedWorktreesInGroups === true ? 'duplicate-in-groups' : 'single-location'
}

/** Which glyph a group header draws; each client maps it to its own icon and tone. */
export type SidebarHeaderIcon =
  | { kind: 'pinned' }
  | { kind: 'all' }
  | { kind: 'project' }
  | { kind: 'pr-status'; prGroup: PRGroupKey }
  | { kind: 'workspace-status'; status: WorkspaceStatus }

/** A worktree's PR lane, read by each client from its own PR facts. */
export type SidebarPRGroupReader = (worktree: Worktree) => PRGroupKey

export type GroupHeaderRow = {
  type: 'header'
  collapseKey?: string
  key: string
  /** Data label (project, project group, status); absent when the client names the header from its icon. */
  label?: string
  count: number
  icon: SidebarHeaderIcon
  repo?: Repo
  projectGroup?: ProjectGroup | { id: null; name: 'Ungrouped'; tabOrder: number }
  projectGroupDepth?: number
  hostId?: ExecutionHostId
  /** A project checked out on several hosts: each host's own registration, one header per host section. */
  hostRepos?: ReadonlyMap<ExecutionHostId, Repo>
  /** On a host copy: the project's anchor registration, which project order keys on; `repo` is this host's. */
  anchorRepo?: Repo
  /** An earlier host section already drew this header; order and drag key on that first copy. */
  repeated?: true
  hostWorktreeCounts?: ReadonlyMap<ExecutionHostId, number>
  hostWorktreeIds?: ReadonlyMap<ExecutionHostId, readonly string[]>
  worktreeIds?: readonly string[]
  /** Agent sessions alone sit under it: a project the list has no workspace of, or none. Only the desktop adds these. */
  sessionsOnly?: true
}

export type WorktreeRow = {
  occurrence?: WorktreeOccurrence<Worktree>
  type: 'item'
  rowKey: string
  sectionKey: string
  worktree: Worktree
  repo: Repo | undefined
  depth: number
  groupDepth: number
  isLastLineageChild: boolean
  lineageChildCount: number
  lineageChildWorktreeIds?: readonly string[]
  lineageGroupKey?: string
  lineageCollapsed?: boolean
  /** Every workspace nested under this one, collapsed or not; host-qualified. */
  lineageDescendantIdentities?: WorktreeLineageSource
  hostContextLabel?: string
  showProjectName?: boolean
}

export type ImportedWorktreesCardCandidate = {
  repo: Repo
  hiddenWorktrees: DetectedWorktree[]
}

export type ImportedWorktreesCardRow = {
  type: 'imported-worktrees-card'
  key: string
  /** Set only when the row's project, or this line's host, needs naming among several hosts. */
  hostContextLabel?: string
  hostContextHostId?: ExecutionHostId
} & (
  | { placement: 'repo-group'; repo: Repo; hiddenWorktrees: DetectedWorktree[] }
  // Outside project grouping no header owns a project, so one line covers a host's projects.
  | {
      placement: 'all-projects'
      hostId: ExecutionHostId
      projects: ImportedWorktreesCardCandidate[]
    }
)

export type NewExternalWorktreesInboxCandidate = {
  repo: Repo
  inboxWorktrees: DetectedWorktree[]
}

export type NewExternalWorktreesInboxRow = {
  type: 'new-external-worktrees-inbox'
  key: string
  repo: Repo
  inboxWorktrees: DetectedWorktree[]
  /** Set only when the row's project is checked out on more than one host. */
  hostContextLabel?: string
  hostContextHostId?: ExecutionHostId
}

export type PendingCreationRow = {
  type: 'pending-creation'
  key: string
  creationId: string
  repo: Repo | undefined
}

export type FolderWorkspaceRow = {
  lineageDescendantIdentities?: WorktreeLineageSource
  type: 'folder-workspace'
  key: string
  folderWorkspace: FolderWorkspace
  projectGroup: ProjectGroup
  depth: number
  groupDepth: number
  hostContextLabel?: string
  /** Workspaces nested under this folder; set only when it has any. */
  lineageChildCount?: number
  lineageChildWorktreeIds?: readonly string[]
  lineageGroupKey?: string
  lineageCollapsed?: boolean
}

/** Stable create/repo identity only: subscribing to full progress records would rebuild the list on phase/loader churn. */
export type PendingCreationRef = { creationId: string; repoId: string }

/** A workspace whose sessions a header lists in its place; `hostId` keeps to its card's host where it has one per host. */
export type SessionWorkspaceRef = { worktreeId: string; hostId?: ExecutionHostId }

/** A project's agent sessions that none of its workspaces holds, right under its header. Only the desktop lists them. */
export type ProjectSessionsRow = {
  type: 'project-sessions'
  key: string
  headerKey: string
  /** The project the header names, which a session in a folder of that name need not repeat. */
  project: string | null
  groupDepth: number
  /** While workspaces are hidden: the ones under the header, whose sessions are listed here too. */
  workspaces?: readonly SessionWorkspaceRef[]
  /** False on a later host's copy of a header: the first copy lists the header's own sessions. */
  headerSessions?: false
}

export type Row =
  | GroupHeaderRow
  | ProjectSessionsRow
  | WorktreeRow
  | ImportedWorktreesCardRow
  | NewExternalWorktreesInboxRow
  | PendingCreationRow
  | FolderWorkspaceRow

/** The registration a project header reorders by, or none for a repeated copy. */
export function getHeaderDragRepo(row: GroupHeaderRow): Repo | undefined {
  return row.repeated ? undefined : (row.anchorRepo ?? row.repo)
}

/** A project header whose rows all sit on its own repo's host; one spanning hosts still lists them in hostRepos.
 * A header with no rows is not one: its repo is whichever registration repoMap kept, not proof of a host. */
export function isSingleHostProjectHeader(row: GroupHeaderRow): boolean {
  return (
    row.repo !== undefined &&
    row.hostRepos === undefined &&
    (row.hostId !== undefined || row.count > 0)
  )
}
