import { useLayoutEffect, useMemo } from 'react'
import { listedProjectHeadersStore } from '@/components/live-sessions/links/listed-project-headers-store'
import { useSidebarSessionGroups } from '@/components/live-sessions/links/use-workspace-sessions'
import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import type { HostSectionRow } from '../../../../../../shared/sidebar-list/hosts/host-section-rows'
import {
  getProjectGroupHeaderKey,
  isProjectSectionGroupKey
} from '../../../../../../shared/sidebar-list/sections/group-keys'
import { withProjectSessionRows } from '../../../../../../shared/sidebar-list/sections/project-session-rows'

const NO_PROJECT_HEADERS: ReadonlySet<string> = new Set()

type ListedProjects = {
  sectionRows: HostSectionRow[]
  occurrencePlan: { sections: readonly { key: string }[] }
  effectiveCollapsedGroups: ReadonlySet<string>
}

type ListedProjectGroups = { visibleProjectGroupsForRows: readonly Pick<ProjectGroup, 'id'>[] }

/**
 * Every project header the list has, drawn or folded away under a group or a machine: the
 * sessions no workspace holds sit under these, and after the list for any other project.
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
 * The list's rows with each project's own sessions right under its header. `groupBy` is null
 * while the list shows no rows; only a list grouped by project has headers to list under.
 */
export function useProjectSessionRows(
  { sectionRows, occurrencePlan, effectiveCollapsedGroups }: ListedProjects,
  { visibleProjectGroupsForRows }: ListedProjectGroups,
  groupBy: string | null
): HostSectionRow[] {
  const listsProjects = groupBy === 'repo'
  const listed = useMemo(
    () =>
      listsProjects
        ? getListedProjectHeaderKeys({ sectionRows, occurrencePlan }, visibleProjectGroupsForRows)
        : NO_PROJECT_HEADERS,
    [listsProjects, sectionRows, occurrencePlan, visibleProjectGroupsForRows]
  )
  // Why a layout effect: the sessions after the list regroup in the same paint as the list's headers change.
  useLayoutEffect(() => listedProjectHeadersStore.set(listed), [listed])
  useLayoutEffect(() => () => listedProjectHeadersStore.set(NO_PROJECT_HEADERS), [])
  // Why by name: sessions change far more often than which projects have any.
  const headerKeys = [...useSidebarSessionGroups().byHeader.keys()].sort().join('\n')
  return useMemo(
    () =>
      headerKeys
        ? withProjectSessionRows(
            sectionRows,
            new Set(headerKeys.split('\n')),
            effectiveCollapsedGroups
          )
        : sectionRows,
    [sectionRows, headerKeys, effectiveCollapsedGroups]
  )
}
