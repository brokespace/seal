import { useEffect, useEffectEvent } from 'react'

const SECTION_ATTRIBUTE = 'data-sidebar-keyboard-section'
const SCROLL_CONTAINER_SELECTOR = '[data-worktree-sidebar]'
const ENTER_EVENT = 'sidebar-section-keyboard-enter'

/** Mark the element holding a section's rows; DOM order is arrow-key order. */
export const SIDEBAR_KEYBOARD_SECTION_PROPS = { [SECTION_ATTRIBUTE]: '' }

/** Which of its rows a section takes the cursor on. */
export type SidebarSectionEntryEdge = 'first' | 'last'

/** At a section's own first or last row, offer the arrow-key cursor to the section before or after it. */
export function offerSidebarSectionKeyboardCursor(
  from: Element | null,
  direction: 'up' | 'down'
): boolean {
  const sections = Array.from(
    from?.closest(SCROLL_CONTAINER_SELECTOR)?.querySelectorAll(`[${SECTION_ATTRIBUTE}]`) ?? []
  )
  const index = sections.findIndex((section) => section === from || section.contains(from))
  const neighbour = index === -1 ? undefined : sections[index + (direction === 'down' ? 1 : -1)]
  if (!neighbour) {
    return false
  }
  const edge: SidebarSectionEntryEdge = direction === 'down' ? 'first' : 'last'
  // A section accepts by cancelling; one with no rows to land on leaves the cursor with the sender.
  return !neighbour.dispatchEvent(new CustomEvent(ENTER_EVENT, { cancelable: true, detail: edge }))
}

/** Take the cursor a neighbouring section offers; return false when there is no row to land on. */
export function useSidebarSectionKeyboardEntry(
  getSection: () => Element | null,
  onEnter: (edge: SidebarSectionEntryEdge) => boolean,
  // Sections that mount and unmount their row container re-subscribe on this.
  mounted: unknown = true
): void {
  const resolveSection = useEffectEvent(getSection)
  const enter = useEffectEvent(onEnter)
  useEffect(() => {
    const section = resolveSection()
    if (!section) {
      return
    }
    const handle = (event: Event): void => {
      if (event instanceof CustomEvent && enter(event.detail)) {
        event.preventDefault()
      }
    }
    section.addEventListener(ENTER_EVENT, handle)
    return () => section.removeEventListener(ENTER_EVENT, handle)
  }, [mounted])
}
