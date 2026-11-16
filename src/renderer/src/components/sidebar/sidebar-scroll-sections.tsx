import React, { createContext, useCallback, useContext, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/class-names'

/** DOM nodes for the sidebar sections that share the worktree list's scroll container. */
export type SidebarScrollSectionHosts = {
  /** Ahead of the Projects header. No section renders there; the list's inset measurement still reads it. */
  leading: HTMLElement
  /** The Projects header, pinned while its rows scroll under it. */
  pinnedHeader: HTMLElement
  /** Sections that scroll after the Projects rows. */
  trailing: HTMLElement
}

// -top-px covers the scroll container's 1px top padding, where rows would otherwise show through.
export const SIDEBAR_STICKY_SECTION_HEADER_CLASS = 'sticky -top-px z-40 bg-worktree-sidebar'
const PINNED_HEADER_SELECTOR = '[data-sidebar-scroll-pinned-header]'

const SidebarScrollSectionHostsContext = createContext<SidebarScrollSectionHosts | undefined>(
  undefined
)

export function useSidebarScrollSectionHosts(): SidebarScrollSectionHosts | undefined {
  return useContext(SidebarScrollSectionHostsContext)
}

/** Owns the sections; the list in `children` shows them in its scroll container through SidebarScrollSectionSlots. */
export function SidebarScrollSections({
  pinnedHeader,
  trailing,
  children
}: {
  pinnedHeader: React.ReactNode
  trailing: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  // Why stable nodes: regrouping remounts the scroll root, and sections rendered into it would lose their menus and state.
  const [hosts] = useState<SidebarScrollSectionHosts>(() => {
    const trailingHost = document.createElement('div')
    // Cancels the list's own gutter, as the header's slot does.
    trailingHost.className = '-ml-1 -mr-1 shrink-0'
    return {
      leading: document.createElement('div'),
      pinnedHeader: document.createElement('div'),
      trailing: trailingHost
    }
  })
  return (
    <SidebarScrollSectionHostsContext.Provider value={hosts}>
      {createPortal(pinnedHeader, hosts.pinnedHeader)}
      {createPortal(trailing, hosts.trailing)}
      {children}
    </SidebarScrollSectionHostsContext.Provider>
  )
}

/** Renders inside the scroll container, ahead of its rows; the trailing sections follow the last of them. */
export function SidebarScrollSectionSlots(): React.JSX.Element | null {
  const hosts = useSidebarScrollSectionHosts()
  const adopt = useCallback(
    (slot: HTMLDivElement | null) => {
      if (!slot || !hosts) {
        return
      }
      if (hosts.pinnedHeader.parentElement !== slot) {
        slot.appendChild(hosts.pinnedHeader)
      }
      // Why by hand: the list renders one slot, ahead of its rows, and these sections go after everything it renders.
      const scroller = slot.parentElement
      if (scroller && hosts.trailing.parentElement !== scroller) {
        scroller.appendChild(hosts.trailing)
      }
    },
    [hosts]
  )
  if (!hosts) {
    return null
  }
  return (
    // Negative margins cancel the list's own gutter so section headers keep the sidebar's edge.
    <div
      ref={adopt}
      data-sidebar-scroll-pinned-header
      className={cn('-ml-1 -mr-1 shrink-0', SIDEBAR_STICKY_SECTION_HEADER_CLASS)}
    />
  )
}

/** Height the pinned Projects header covers at the top of the scroll container. */
export function getSidebarStickyInset(scrollContainer: Element): number {
  const header = scrollContainer.querySelector<HTMLElement>(PINNED_HEADER_SELECTOR)
  return header?.offsetHeight ?? 0
}
