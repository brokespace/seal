import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { isWebClientLocation } from '@/app-shell/platform/web-client-location'
import { useSidebarScrollSectionHosts } from '@/components/sidebar/sidebar-scroll-sections'
import { useSidebarSessionRowKeyboard } from './session-row-keyboard'
import { useSidebarSessionRowReveal } from './session-row-reveal'
import { SidebarSessionsToolbar } from './SidebarSessionsToolbar'

function SidebarSessionsBody(): React.JSX.Element | null {
  const hosts = useSidebarScrollSectionHosts()
  // Why after the first commit: the Projects header is portaled into the same host and must stay ahead of the toolbar.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  useSidebarSessionRowKeyboard()
  useSidebarSessionRowReveal()
  return mounted && hosts ? createPortal(<SidebarSessionsToolbar />, hosts.pinnedHeader) : null
}

/**
 * What the sidebar list shows of sessions besides their rows: the toolbar pinned over the whole
 * list. It also makes those rows one keyboard list with the workspaces, and reveals one asked for.
 */
const SidebarSessions = React.memo(function SidebarSessions() {
  // Windows without the registry (a paired web client) have no sessions to list or filter.
  // Why both: the web client answers for every missing part of `window.api`.
  if (isWebClientLocation() || !window.api?.liveSessions?.onEvent) {
    return null
  }
  return <SidebarSessionsBody />
})

export default SidebarSessions
