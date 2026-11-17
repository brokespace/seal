import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { liveSessionMarksStore } from '../live-session-marks-store'
import { liveSessionRegistryStore } from '../live-session-registry-store'
import { SIDEBAR_SESSION_ROW } from './sidebar-session-row-dom'

/** Where a Shift-pick range starts: one for the whole sidebar, so a range can span sections and workspaces. */
let anchor: string | null = null

/** The session rows the sidebar list shows, top to bottom: each workspace's and each header's. */
export function sidebarSessionRowIds(): string[] {
  const ids = new Set<string>()
  for (const row of document.querySelectorAll<HTMLElement>(SIDEBAR_SESSION_ROW)) {
    if (row.dataset.liveSessionRow) {
      ids.add(row.dataset.liveSessionRow)
    }
  }
  return [...ids]
}

/** Pick a session for a bulk action; `range` picks every row from the last one picked to this one. */
export function pickSidebarSessionRow(session: LiveSession, range: boolean): void {
  const order = sidebarSessionRowIds()
  const from = range && anchor ? order.indexOf(liveSessionRegistryStore.currentId(anchor)) : -1
  const to = order.indexOf(session.id)
  if (from !== -1 && to !== -1) {
    const picked = new Set(liveSessionMarksStore.getState().picked)
    for (const id of order.slice(Math.min(from, to), Math.max(from, to) + 1)) {
      picked.add(id)
    }
    liveSessionMarksStore.setPicked(picked)
    return
  }
  anchor = session.id
  liveSessionMarksStore.togglePicked(session.id)
}
