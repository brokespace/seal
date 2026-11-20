import { useLayoutEffect, useMemo } from 'react'
import { listedProjectHeadersStore } from '@/components/live-sessions/links/listed-project-headers-store'
import { useListedSessionHeaders } from '@/components/live-sessions/links/use-listed-session-headers'
import { useSidebarSessionGroups } from '@/components/live-sessions/links/use-workspace-sessions'
import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import type { HostSectionRow } from '../../../../../../shared/sidebar-list/hosts/host-section-rows'
import {
  getProjectGroupHeaderKey,
  isProjectSectionGroupKey
} from '../../../../../../shared/sidebar-list/sections/group-keys'
import { useAppStore } from '@/store/index'
import { setHiddenWorkspaceHeaders } from '@/components/live-sessions/workspace-rows/hidden-workspace-headers'
import {
  withProjectSessionRows,
  withSessionsInPlaceOfWorkspaces
} from '../../../../../../shared/sidebar-list/sections/project-session-rows'

const NO_PROJECT_HEADERS: ReadonlySet<string> = new Set()
const NO_ROWS: HostSectionRow[] = []

/** Each workspace's project header, also under a folded header: the header lists the workspace's sessions in its place. */
function workspaceHeaders(rows: readonly HostSectionRow[]): Map<string, string> {
  const headers = new Map<string, string>()
  for (const row of rows) {
    if (row.type === 'header' && isProjectSectionGroupKey(row.key)) {
      for (const worktreeId of row.worktreeIds ?? []) {
        headers.set(worktreeId, row.key)
      }
    } else if (row.type === 'project-sessions') {
      for (const { worktreeId } of row.workspaces ?? []) {
        headers.set(worktreeId, row.headerKey)
      }
    }
  }
  return headers
}

type ListedProjects = {
  sectionRows: HostSectionRow[]
  occurrencePlan: { sections: readonly { key: string }[] }
  effectiveCollapsedGroups: ReadonlySet<string>
}

type ListedProjectGroups = { visibleProjectGroupsForRows: readonly Pick<ProjectGroup, 'id'>[] }

/**
 * Every project header the list has, drawn or folded away under a group or a machine: the
 * sessions no workspace holds sit under these, and under a header of their own for any other project.
 */
export function getListedProjectHeaderKeys(
  { sectionRows, occurrencePlan }: Pick<ListedProjects, 'sectionRows' | 'occurrencePlan'>,
  projectGroups: ListedProjectGroups['visibleProjectGroupsForRows']
): ReadonlySet<string> {
  const keys = new Set<string>()
  for (const row of sectionRows) {
    if (row.type === 'header' && isProjectSectionGroupKey(row.key)) {
      keys.add(row.key)
    }
  }
  for (const { key } of occurrencePlan.sections) {
    if (isProjectSectionGroupKey(key)) {
      keys.add(key)
    }
  }
  for (const { id } of projectGroups) {
    keys.add(getProjectGroupHeaderKey(id))
  }
  return keys
}

/**
 * The list's rows with the sessions no workspace holds: right under their project's header, and
 * after the last workspace under a header of their own for a project the list has none for.
 * `groupBy` is null while the list has no workspace to show; only a list grouped by project has
 * project headers to list under, and lists every session there while its workspaces are hidden.
 */
export function useProjectSessionRows(
  { sectionRows, occurrencePlan, effectiveCollapsedGroups }: ListedProjects,
  { visibleProjectGroupsForRows }: ListedProjectGroups,
  groupBy: string | null
): HostSectionRow[] {
  const listsProjects = groupBy === 'repo'
  const hideWorkspaces = useAppStore((state) => state.hideSidebarWorkspaces) && listsProjects
  const listed = useMemo(
    () =>
      listsProjects
        ? getListedProjectHeaderKeys({ sectionRows, occurrencePlan }, visibleProjectGroupsForRows)
        : NO_PROJECT_HEADERS,
    [listsProjects, sectionRows, occurrencePlan, visibleProjectGroupsForRows]
  )
  // Why a layout effect: the sessions regroup in the same paint as the list's headers change.
  useLayoutEffect(() => listedProjectHeadersStore.set(listed), [listed])
  useLayoutEffect(() => () => listedProjectHeadersStore.set(NO_PROJECT_HEADERS), [])
  // Why by name: sessions change far more often than which projects have any.
  const headerKeys = [...useSidebarSessionGroups().byHeader.keys()].sort().join('\n')
  const sessionHeaders = useListedSessionHeaders()
  const rows = groupBy === null ? NO_ROWS : sectionRows
  const result = useMemo(() => {
    if (hideWorkspaces) {
      return withSessionsInPlaceOfWorkspaces(rows, effectiveCollapsedGroups, sessionHeaders)
    }
    return headerKeys
      ? withProjectSessionRows(
          rows,
          new Set(headerKeys.split('\n')),
          effectiveCollapsedGroups,
          sessionHeaders
        )
      : rows
  }, [hideWorkspaces, rows, headerKeys, effectiveCollapsedGroups, sessionHeaders])
  useLayoutEffect(
    () => setHiddenWorkspaceHeaders(hideWorkspaces ? workspaceHeaders(result) : null),
    [hideWorkspaces, result]
  )
  useLayoutEffect(() => () => setHiddenWorkspaceHeaders(null), [])
  return result
}
