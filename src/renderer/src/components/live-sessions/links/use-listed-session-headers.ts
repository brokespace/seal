import { useTranslate } from '@/i18n/use-translate'
import type { SessionsOnlyHeader } from '../../../../../shared/sidebar-list/sections/project-session-rows'
import { useLiveSessionClock } from '../live-session-clock'
import { isListedLiveSession } from '../row/live-session-machine-listing'
import {
  matchesSidebarSessionFilters,
  useSidebarSessionFilters,
  type SidebarSessionFilters
} from '../workspace-rows/sidebar-session-filter-store'
import type { SidebarSessionGroups } from './sidebar-session-groups'
import { useSidebarSessionGroups } from './use-workspace-sessions'

/**
 * The headers the sessions bring to the list, each while it has a row to show: sessions the
 * filters leave out are not listed, and the toolbar says when nothing matches at all.
 */
export function listedSessionHeaders(
  { sessionHeaders, byHeader }: Pick<SidebarSessionGroups, 'sessionHeaders' | 'byHeader'>,
  filters: SidebarSessionFilters,
  now: number,
  unassignedLabel: string
): SessionsOnlyHeader[] {
  return sessionHeaders.flatMap(({ key, name }) => {
    const count = (byHeader.get(key) ?? []).filter(
      (session) =>
        isListedLiveSession(session, now) && matchesSidebarSessionFilters(session, filters)
    ).length
    return count > 0 ? [{ key, label: name ?? unassignedLabel, project: name, count }] : []
  })
}

let last: { signature: string; headers: readonly SessionsOnlyHeader[] } | null = null

/** The same array for as long as the headers say the same: the list rebuilds its rows only when they change. */
function unchanged(headers: readonly SessionsOnlyHeader[]): readonly SessionsOnlyHeader[] {
  const signature = JSON.stringify(headers)
  if (last?.signature !== signature) {
    last = { signature, headers }
  }
  return last.headers
}

export function useListedSessionHeaders(): readonly SessionsOnlyHeader[] {
  const t = useTranslate()
  const groups = useSidebarSessionGroups()
  const filters = useSidebarSessionFilters()
  const now = useLiveSessionClock()
  return unchanged(
    listedSessionHeaders(groups, filters, now, t('seal.sessionTab.unassigned', 'Unassigned'))
  )
}
