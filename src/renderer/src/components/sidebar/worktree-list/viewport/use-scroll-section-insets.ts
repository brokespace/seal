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
  resolveScrollTopBeforeLeadingResize,
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
    let settledScrollTop = scrollElement.scrollTop
    const recordSettledScrollTop = (): void => {
      const now = measure(hosts)
      const known = insetsRef.current
      // A scroll event ahead of the resize callback reports the browser's clamp, not where the user was.
      if (now.leading === known.leading && now.pinned === known.pinned) {
        settledScrollTop = scrollElement.scrollTop
      }
    }
    scrollElement.addEventListener('scroll', recordSettledScrollTop, { passive: true })
    const observer = new ResizeObserver(() => {
      const previous = insetsRef.current
      const next = measure(hosts)
      if (!apply(next)) {
        return
      }
      const current = scrollElement.scrollTop
      const before = resolveScrollTopBeforeLeadingResize({
        scrollTop: current,
        maxScrollTop: scrollElement.scrollHeight - scrollElement.clientHeight,
        lastKnownScrollTop: settledScrollTop
      })
      const target = resolveScrollTopAfterLeadingResize({ scrollTop: before, previous, next })
      if (target !== current) {
        programmaticScrollMarks.mark(target)
        scrollElement.scrollTop = target
      }
      const scrolledBy = scrollElement.scrollTop - before
      const anchor = scrollAnchorRef.current
      if (anchor) {
        // The anchor row moved with the sections above it; keep its recorded offset from the pinned header true.
        anchor.offset +=
          scrolledBy +
          (next.pinned - previous.pinned) -
          (getScrollSectionMargin(next) - getScrollSectionMargin(previous))
        if (anchor.scrollTop !== undefined) {
          anchor.scrollTop = scrollElement.scrollTop
        }
      }
      scrollOffsetRef.current = scrollElement.scrollTop
      settledScrollTop = scrollElement.scrollTop
      // Why sync: rows must take their new offsets in the frame that moved the sections.
      flushSync(() => {
        setInsets(next)
        if (scrolledBy !== 0) {
          // Why one render: rows laid out with the new margin and the stale offset would be measured out of view.
          scrollElement.dispatchEvent(new Event('scroll'))
        }
      })
    })
    observer.observe(hosts.leading)
    observer.observe(hosts.pinnedHeader)
    return () => {
      observer.disconnect()
      scrollElement.removeEventListener('scroll', recordSettledScrollTop)
    }
  }, [hosts, programmaticScrollMarks, scrollAnchorRef, scrollElement, scrollOffsetRef])

  return hosts ? insets : NO_SCROLL_SECTION_INSETS
}
