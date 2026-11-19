import type { PersistedState } from '../../../../shared/persisted-state-types'

type RawGroup = {
  id?: unknown
  parentGroupId?: unknown
  sessionProject?: unknown
  keptAt?: unknown
}

/**
 * Drops the empty project groups older desktops made for sessions and never made permanent: auto
 * projects are now projects Seal adds at the session's folder. A kept or occupied one stays a group.
 */
export function withoutRetiredSessionProjectGroups(
  parsed: Pick<PersistedState, 'projectGroups' | 'repos' | 'folderWorkspaces'>
): { groups: unknown; dropped: boolean } {
  const groups: unknown = parsed.projectGroups
  if (!Array.isArray(groups)) {
    return { groups, dropped: false }
  }
  const occupied = new Set<unknown>([
    ...(parsed.repos ?? []).map((repo) => repo.projectGroupId),
    ...(parsed.folderWorkspaces ?? []).map((workspace) => workspace.projectGroupId),
    ...groups.map((group: RawGroup | null) => group?.parentGroupId)
  ])
  const kept = groups.filter(
    (group: RawGroup | null) =>
      !group?.sessionProject || typeof group.keptAt === 'number' || occupied.has(group.id)
  )
  return { groups: kept, dropped: kept.length !== groups.length }
}
