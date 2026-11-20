import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { isWebClientLocation } from '@/app-shell/platform/web-client-location'
import { useSidebarScrollSectionHosts } from '@/components/sidebar/sidebar-scroll-sections'
import { useSidebarSessionRowKeyboard } from './session-row-keyboard'
import { useSidebarSessionRowReveal } from './session-row-reveal'
import { SessionSelectionBar } from './SessionSelectionBar'

/** Windows without the registry (a paired web client) have no sessions to list. */
export function windowListsLiveSessions(): boolean {
  // Why both: the web client answers for every missing part of `window.api`.
  return !isWebClientLocation() && Boolean(window.api?.liveSessions?.onEvent)
}

function SidebarSessionsBody(): React.JSX.Element | null {
  const hosts = useSidebarScrollSectionHosts()
  // Why after the first commit: the Projects header is portaled into the same host and must stay ahead of the bar.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  useSidebarSessionRowKeyboard()
  useSidebarSessionRowReveal()
  return mounted && hosts
    ? createPortal(
        <div className="px-3 pb-1 empty:hidden">
          <SessionSelectionBar />
        </div>,
        hosts.pinnedHeader
      )
    : null
}

/**
 * What the sidebar list does with sessions besides their rows: the bulk actions pinned over the
 * list while sessions are selected, one keyboard list with the workspaces, and a row asked for revealed.
 */
const SidebarSessions = React.memo(function SidebarSessions() {
  return windowListsLiveSessions() ? <SidebarSessionsBody /> : null
})

export default SidebarSessions
