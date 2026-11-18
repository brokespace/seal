import { folderWorkspaceToWorktree } from '../../folder-workspaces/folder-workspace-worktree'
import type { HostSectionRow } from '../hosts/host-section-rows'
import type { ProjectSessionsRow, SessionWorkspaceRef } from '../row-types'

export function projectSessionsRowKey(headerKey: string): string {
  return `project-sessions:${headerKey}`
}

/** A header the sessions bring to the list: a project it has no workspace of, or none for sessions with no folder. */
export type SessionsOnlyHeader = {
  /** Also what folds it. */
  key: string
  label: string
  /** The project it names; null when the sessions have none. */
  project: string | null
  count: number
}

function appendSessionsOnlyHeaders(
  result: HostSectionRow[],
  collapsedGroups: ReadonlySet<string>,
  sessionsOnly: readonly SessionsOnlyHeader[]
): HostSectionRow[] {
  for (const { key, label, project, count } of sessionsOnly) {
    result.push({
      type: 'header',
      key,
      label,
      count,
      icon: { kind: 'project' },
      sessionsOnly: true
    })
    if (!collapsedGroups.has(key)) {
      result.push({
        type: 'project-sessions',
        key: projectSessionsRowKey(key),
        headerKey: key,
        project,
        groupDepth: 1
      })
    }
  }
  return result
}

/**
 * Adds a sessions row under each unfolded project header in `headerKeys`, ahead of its workspaces,
 * then each of `sessionsOnly` as a header of its own after the last workspace. A header repeated
 * per host gets the row once, under its first copy.
 */
export function withProjectSessionRows(
  rows: readonly HostSectionRow[],
  headerKeys: ReadonlySet<string>,
  collapsedGroups: ReadonlySet<string>,
  sessionsOnly: readonly SessionsOnlyHeader[] = []
): HostSectionRow[] {
  const placed = new Set<string>()
  const result: HostSectionRow[] = []
  for (const row of rows) {
    result.push(row)
    if (
      row.type !== 'header' ||
      !headerKeys.has(row.key) ||
      placed.has(row.key) ||
      collapsedGroups.has(row.collapseKey ?? row.key)
    ) {
      continue
    }
    placed.add(row.key)
    result.push({
      type: 'project-sessions',
      key: projectSessionsRowKey(row.key),
      headerKey: row.key,
      project: row.label ?? null,
      groupDepth: (row.projectGroupDepth ?? 0) + 1
    })
  }
  return appendSessionsOnlyHeaders(result, collapsedGroups, sessionsOnly)
}

/** The workspaces a row draws, its folded lineage children included: their sessions have no other row to sit on. */
function workspacesOfRow(
  row: HostSectionRow
): { groupDepth: number; workspaces: SessionWorkspaceRef[] } | null {
  if (row.type !== 'item' && row.type !== 'folder-workspace') {
    return null
  }
  const own = row.type === 'item' ? row.worktree : folderWorkspaceToWorktree(row.folderWorkspace)
  const folded = row.lineageCollapsed ? (row.lineageChildWorktreeIds ?? []) : []
  return {
    groupDepth: row.groupDepth,
    workspaces: [own.id, ...folded].map((worktreeId) => ({ worktreeId, hostId: own.hostId }))
  }
}

type CollectingSessionsRow = ProjectSessionsRow & { workspaces: SessionWorkspaceRef[] }

/**
 * The list with its workspaces hidden: each unfolded header keeps one sessions row right under
 * it, listing its own sessions and those of every workspace it would have shown, then the headers
 * the sessions bring. A header repeated per host lists its own sessions under its first copy only.
 */
export function withSessionsInPlaceOfWorkspaces(
  rows: readonly HostSectionRow[],
  collapsedGroups: ReadonlySet<string>,
  sessionsOnly: readonly SessionsOnlyHeader[] = []
): HostSectionRow[] {
  const result: HostSectionRow[] = []
  const placed = new Set<string>()
  // The sessions row of the header open at each project-group depth; a workspace goes to the one around it.
  let open: (CollectingSessionsRow | null)[] = []
  const seen = new Map<CollectingSessionsRow, Set<string>>()
  for (const row of rows) {
    if (row.type === 'host-header') {
      result.push(row)
      open = []
      continue
    }
    if (row.type === 'header') {
      result.push(row)
      const depth = row.projectGroupDepth ?? 0
      open = open.slice(0, depth)
      if (collapsedGroups.has(row.collapseKey ?? row.key)) {
        open[depth] = null
        continue
      }
      const first = !placed.has(row.key)
      placed.add(row.key)
      const sessions: CollectingSessionsRow = {
        type: 'project-sessions',
        key: first
          ? projectSessionsRowKey(row.key)
          : `${projectSessionsRowKey(row.key)}@${row.hostId ?? result.length}`,
        headerKey: row.key,
        project: row.label ?? null,
        groupDepth: depth + 1,
        workspaces: [],
        ...(first ? {} : { headerSessions: false as const })
      }
      result.push(sessions)
      open[depth] = sessions
      continue
    }
    const drawn = workspacesOfRow(row)
    if (!drawn) {
      // Notices about workspaces (hidden imports, new external ones, ones being created) go with them.
      continue
    }
    const owner = open[drawn.groupDepth - 1] ?? open.findLast((candidate) => candidate) ?? null
    if (!owner) {
      continue
    }
    const ids = seen.get(owner) ?? new Set<string>()
    seen.set(owner, ids)
    for (const workspace of drawn.workspaces) {
      if (!ids.has(workspace.worktreeId)) {
        ids.add(workspace.worktreeId)
        owner.workspaces.push(workspace)
      }
    }
  }
  return appendSessionsOnlyHeaders(result, collapsedGroups, sessionsOnly)
}
