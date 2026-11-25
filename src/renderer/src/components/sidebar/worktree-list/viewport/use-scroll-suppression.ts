import {
  requestVirtualizedScrollAnchorRecord,
  supersedeVirtualizedScrollAnchorRestore
} from '@/hooks/requestVirtualizedScrollAnchorRecord'
import { useCallback, useEffect, useRef } from 'react'
import type React from 'react'
import {
  createPendingRevealScroll,
  isRevealScrollSettling,
  type PendingRevealScroll
} from '../navigation/worktree-sidebar-reveal-scroll-settle'

export type WorktreeSidebarScrollSuppression = ReturnType<
  typeof useWorktreeSidebarScrollSuppression
>

// Explicit input retires the previous target; smooth reveal owns its settling position.
export function useWorktreeSidebarScrollSuppression(
  scrollRef: React.RefObject<HTMLDivElement | null>,
  scrollElement: HTMLElement | null = null
) {
  const pendingRevealScrollRef = useRef<PendingRevealScroll | null>(null)
  const cancelRevealScroll = useCallback(() => {
    pendingRevealScrollRef.current = null
  }, [])

  const markDirectScrollInput = useCallback(() => {
    supersedeVirtualizedScrollAnchorRestore(scrollRef.current)
    cancelRevealScroll()
    requestVirtualizedScrollAnchorRecord(scrollRef.current, { deferDomMeasurement: true })
  }, [cancelRevealScroll, scrollRef])
  // Why native: sections portaled into the scroll root bubble React events to their owner, not to this list.
  useEffect(() => {
    if (!scrollElement) {
      return
    }
    const markScrollbarPress = (event: PointerEvent): void => {
      const scrollbarWidth = scrollElement.offsetWidth - scrollElement.clientWidth
      if (
        scrollbarWidth > 0 &&
        event.clientX >= scrollElement.getBoundingClientRect().right - scrollbarWidth
      ) {
        markDirectScrollInput()
      }
    }
    scrollElement.addEventListener('wheel', markDirectScrollInput, { passive: true })
    scrollElement.addEventListener('touchmove', markDirectScrollInput, { passive: true })
    scrollElement.addEventListener('pointerdown', markScrollbarPress)
    return () => {
      scrollElement.removeEventListener('wheel', markDirectScrollInput)
      scrollElement.removeEventListener('touchmove', markDirectScrollInput)
      scrollElement.removeEventListener('pointerdown', markScrollbarPress)
    }
  }, [markDirectScrollInput, scrollElement])
  const markRevealScroll = useCallback((targetTop: number) => {
    pendingRevealScrollRef.current = createPendingRevealScroll(targetTop, window.performance.now())
  }, [])
  const isRevealScrollSettlingNow = useCallback(() => {
    const settling = isRevealScrollSettling({
      now: window.performance.now(),
      pending: pendingRevealScrollRef.current,
      scrollTop: scrollRef.current?.scrollTop ?? 0
    })
    if (!settling) {
      pendingRevealScrollRef.current = null
    }
    return settling
  }, [scrollRef])

  return {
    cancelRevealScroll,
    markDirectScrollInput,
    markRevealScroll,
    shouldSkipScrollAnchorRestore: isRevealScrollSettlingNow
  }
}
