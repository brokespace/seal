import React, { createContext, useCallback, useContext, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/class-names'

/** DOM nodes for the sidebar sections that share the worktree list's scroll container. */
export type SidebarScrollSectionHosts = {
  /** Sections that scroll ahead of the Projects rows. */
  leading: HTMLElement
  /** The Projects header, pinned while its rows scroll under it. */
  pinnedHeader: HTMLElement
}

// -top-px covers the scroll container's 1px top padding, where rows would otherwise show through.
export const SIDEBAR_STICKY_SECTION_HEADER_CLASS = 'sticky -top-px z-40 bg-worktree-sidebar'
const PINNED_HEADER_SELECTOR = '[data-sidebar-scroll-pinned-header]'
const LEADING_SELECTOR = '[data-sidebar-scroll-leading]'

const SidebarScrollSectionHostsContext = createContext<SidebarScrollSectionHosts | undefined>(
  undefined
)

export function useSidebarScrollSectionHosts(): SidebarScrollSectionHosts | undefined {
  return useContext(SidebarScrollSectionHostsContext)
}

/** Owns the sections; the list in `children` shows them in its scroll container through SidebarScrollSectionSlots. */
export function SidebarScrollSections({
  leading,
  pinnedHeader,
  children
}: {
  leading: React.ReactNode
  pinnedHeader: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  // Why stable nodes: regrouping remounts the scroll root, and sections rendered into it would lose their menus and state.
  const [hosts] = useState<SidebarScrollSectionHosts>(() => ({
    leading: document.createElement('div'),
    pinnedHeader: document.createElement('div')
  }))
  return (
    <SidebarScrollSectionHostsContext.Provider value={hosts}>
      {createPortal(leading, hosts.leading)}
      {createPortal(pinnedHeader, hosts.pinnedHeader)}
      {children}
    </SidebarScrollSectionHostsContext.Provider>
  )
}

function useAdoptedHost(host: HTMLElement | undefined): React.RefCallback<HTMLDivElement> {
  return useCallback(
    (slot) => {
      if (slot && host && host.parentElement !== slot) {
        slot.appendChild(host)
      }
    },
    [host]
  )
}

/** Renders inside the scroll container, ahead of its rows. */
export function SidebarScrollSectionSlots(): React.JSX.Element | null {
  const hosts = useSidebarScrollSectionHosts()
  const adoptLeading = useAdoptedHost(hosts?.leading)
  const adoptPinnedHeader = useAdoptedHost(hosts?.pinnedHeader)
  if (!hosts) {
    return null
  }
  return (
    <>
      {/* Negative margins cancel the list's own gutter so section headers keep the sidebar's edge. */}
      <div ref={adoptLeading} data-sidebar-scroll-leading className="-ml-1 -mr-1 shrink-0" />
      <div
        ref={adoptPinnedHeader}
        data-sidebar-scroll-pinned-header
        className={cn('-ml-1 -mr-1 shrink-0', SIDEBAR_STICKY_SECTION_HEADER_CLASS)}
      />
    </>
  )
}

/** Height the pinned Projects header covers at the top of the scroll container. */
export function getSidebarStickyInset(scrollContainer: Element): number {
  const header = scrollContainer.querySelector<HTMLElement>(PINNED_HEADER_SELECTOR)
  return header?.offsetHeight ?? 0
}

/** Scroll an element of a leading section fully into the list, clear of the section header pinned over it. */
export function revealInSidebarScrollSection(element: HTMLElement, pinned: Element | null): void {
  const scroller = element.closest(LEADING_SELECTOR)?.parentElement
  if (!scroller) {
    element.scrollIntoView?.({ block: 'nearest' })
    return
  }
  const view = scroller.getBoundingClientRect()
  // The header is pinned at the top of the list by the time the element gets there.
  const top = view.top + (pinned?.getBoundingClientRect().height ?? 0)
  const rect = element.getBoundingClientRect()
  if (rect.top < top) {
    scroller.scrollTop -= top - rect.top
  } else if (rect.bottom > view.bottom) {
    scroller.scrollTop += Math.min(rect.bottom - view.bottom, rect.top - top)
  }
}
