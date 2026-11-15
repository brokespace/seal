import { useLayoutEffect, useRef, useState } from 'react'
import type React from 'react'
import { flushSync } from 'react-dom'
import type { ProgrammaticScrollMarks } from '@/hooks/programmatic-scroll-marks'
import type { VirtualizedScrollAnchor } from '@/hooks/useVirtualizedScrollAnchor'
import {
  useSidebarScrollSectionHosts,
  type SidebarScrollSectionHosts
} from '../../sidebar-scroll-sections'
import {
  getScrollSectionMargin,
  NO_SCROLL_SECTION_INSETS,
  resolveScrollTopAfterLeadingResize,
  type ScrollSectionInsets
} from './scroll-section-insets'

function measure(hosts: SidebarScrollSectionHosts): ScrollSectionInsets {
  return { leading: hosts.leading.offsetHeight, pinned: hosts.pinnedHeader.offsetHeight }
}

/** Track the sections sharing the list's scroll container, and hold the rows still when they resize. */
export function useScrollSectionInsets(args: {
  scrollElement: HTMLElement | null
  scrollOffsetRef: React.MutableRefObject<number>
  scrollAnchorRef: React.MutableRefObject<VirtualizedScrollAnchor>
  programmaticScrollMarks: ProgrammaticScrollMarks
}): ScrollSectionInsets {
  const { scrollElement, scrollOffsetRef, scrollAnchorRef, programmaticScrollMarks } = args
  const hosts = useSidebarScrollSectionHosts()
  // Why read during render: a regrouping remount must lay out its first rows below the sections, which are still mounted.
  const [insets, setInsets] = useState<ScrollSectionInsets>(() =>
    hosts ? measure(hosts) : NO_SCROLL_SECTION_INSETS
  )
  const insetsRef = useRef(insets)

  useLayoutEffect(() => {
    if (!hosts || !scrollElement) {
      return
    }
    const apply = (next: ScrollSectionInsets): boolean => {
      const previous = insetsRef.current
      if (previous.leading === next.leading && previous.pinned === next.pinned) {
        return false
      }
      insetsRef.current = next
      return true
    }
    const initial = measure(hosts)
    if (apply(initial)) {
      setInsets(initial)
    }
    if (typeof ResizeObserver === 'undefined') {
      return
    }
    const observer = new ResizeObserver(() => {
      const previous = insetsRef.current
      const next = measure(hosts)
      if (!apply(next)) {
        return
      }
      const before = scrollElement.scrollTop
      const target = resolveScrollTopAfterLeadingResize({ scrollTop: before, previous, next })
      if (target !== before) {
        programmaticScrollMarks.mark(target)
        scrollElement.scrollTop = target
      }
      const scrolledBy = scrollElement.scrollTop - before
      const anchor = scrollAnchorRef.current
      if (anchor) {
        // The anchor row moved with the sections above it; keep its recorded viewport offset true.
        anchor.offset +=
          scrolledBy - (getScrollSectionMargin(next) - getScrollSectionMargin(previous))
        if (anchor.scrollTop !== undefined) {
          anchor.scrollTop = scrollElement.scrollTop
        }
      }
      scrollOffsetRef.current = scrollElement.scrollTop
      // Why sync: rows must take their new offsets in the frame that moved the sections.
      flushSync(() => setInsets(next))
      if (scrolledBy !== 0) {
        // The native scroll event arrives a frame late; the virtualizer needs the offset now.
        scrollElement.dispatchEvent(new Event('scroll'))
      }
    })
    observer.observe(hosts.leading)
    observer.observe(hosts.pinnedHeader)
    return () => observer.disconnect()
  }, [hosts, programmaticScrollMarks, scrollAnchorRef, scrollElement, scrollOffsetRef])

  return hosts ? insets : NO_SCROLL_SECTION_INSETS
}
