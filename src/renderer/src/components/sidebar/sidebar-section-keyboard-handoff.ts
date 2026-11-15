import { useEffect } from 'react'
import { useLatestHandler } from '@/lib/use-latest-handler'

const SECTION_ATTRIBUTE = 'data-sidebar-keyboard-section'
const SCROLL_CONTAINER_SELECTOR = '[data-worktree-sidebar]'
const ENTER_EVENT = 'sidebar-section-keyboard-enter'

/** Mark the element holding a section's rows; DOM order is arrow-key order. */
export const SIDEBAR_KEYBOARD_SECTION_PROPS = { [SECTION_ATTRIBUTE]: '' }

/** Which of its rows a section takes the cursor on. */
export type SidebarSectionEntryEdge = 'first' | 'last'

/** At a section's own first or last row, offer the arrow-key cursor to the next section that way; the list's two ends meet. */
export function offerSidebarSectionKeyboardCursor(
  from: Element | null,
  direction: 'up' | 'down'
): boolean {
  const sections = Array.from(
    from?.closest(SCROLL_CONTAINER_SELECTOR)?.querySelectorAll(`[${SECTION_ATTRIBUTE}]`) ?? []
  )
  const index = sections.findIndex((section) => section === from || section.contains(from))
  if (index === -1) {
    return false
  }
  const step = direction === 'down' ? 1 : -1
  const edge: SidebarSectionEntryEdge = direction === 'down' ? 'first' : 'last'
  for (let distance = 1; distance < sections.length; distance++) {
    const candidate = sections.at((index + step * distance) % sections.length)
    // A section accepts by cancelling; one with no rows to land on passes the offer along.
    const accepted = !candidate?.dispatchEvent(
      new CustomEvent(ENTER_EVENT, { bubbles: true, cancelable: true, detail: edge })
    )
    if (accepted) {
      return true
    }
  }
  return false
}

/** Take the cursor a neighbouring section offers; return false when there is no row to land on. */
export function useSidebarSectionKeyboardEntry(
  getSection: () => Element | null,
  onEnter: (edge: SidebarSectionEntryEdge) => boolean
): void {
  // Why not useEffectEvent: React 19.2 never refreshes it inside React.memo components, which both sections are.
  const resolveSection = useLatestHandler(getSection)
  const enter = useLatestHandler(onEnter)
  useEffect(() => {
    // Why on the document: a section's row container mounts and unmounts with its rows; the offer bubbles from whichever one exists now.
    const handle = (event: Event): void => {
      if (
        event instanceof CustomEvent &&
        event.target === resolveSection() &&
        enter(event.detail)
      ) {
        event.preventDefault()
      }
    }
    document.addEventListener(ENTER_EVENT, handle)
    return () => document.removeEventListener(ENTER_EVENT, handle)
  }, [resolveSection, enter])
}
