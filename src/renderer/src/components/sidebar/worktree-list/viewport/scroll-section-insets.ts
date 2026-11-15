export type ScrollSectionInsets = {
  /** Height of the sections scrolling ahead of the pinned header. */
  leading: number
  /** Height of the header pinned above the rows. */
  pinned: number
}

/** Set on the scroll container; rows and pinned group headers position themselves against them. */
export const SCROLL_SECTION_MARGIN_VARIABLE = '--sidebar-scroll-margin'
export const SCROLL_SECTION_STICKY_INSET_VARIABLE = '--sidebar-sticky-inset'

export const NO_SCROLL_SECTION_INSETS: ScrollSectionInsets = { leading: 0, pinned: 0 }

/** Where the rows start in scroll coordinates. */
export function getScrollSectionMargin(insets: ScrollSectionInsets): number {
  return insets.leading + insets.pinned
}

/** Where the viewport was before the sections resized: a shrinking section lets the browser clamp scrollTop first. */
export function resolveScrollTopBeforeLeadingResize(args: {
  scrollTop: number
  maxScrollTop: number
  lastKnownScrollTop: number
}): number {
  const { scrollTop, maxScrollTop, lastKnownScrollTop } = args
  return scrollTop >= maxScrollTop - 1 ? Math.max(scrollTop, lastKnownScrollTop) : scrollTop
}

/** Keep what the user is looking at in place when the sections above the rows change height. */
export function resolveScrollTopAfterLeadingResize(args: {
  scrollTop: number
  previous: ScrollSectionInsets
  next: ScrollSectionInsets
}): number {
  const { scrollTop, previous, next } = args
  if (scrollTop > 0 && scrollTop >= previous.leading) {
    // Reading the rows: they must not move when a section above them grows or shrinks.
    return Math.max(0, scrollTop + getScrollSectionMargin(next) - getScrollSectionMargin(previous))
  }
  // Reading the leading sections: stay put, but leave one header's height of them on screen, so folding a section keeps its header in view.
  return Math.min(scrollTop, Math.max(0, next.leading - next.pinned))
}

/** The insets the rows are laid out with now, read back from the scroll container. */
export function readScrollSectionLayout(scrollContainer: HTMLElement): {
  margin: number
  pinned: number
} {
  const read = (variable: string): number =>
    Number.parseFloat(scrollContainer.style.getPropertyValue(variable)) || 0
  return {
    margin: read(SCROLL_SECTION_MARGIN_VARIABLE),
    pinned: read(SCROLL_SECTION_STICKY_INSET_VARIABLE)
  }
}

export function getScrollSectionStyleVariables(
  insets: ScrollSectionInsets
): Record<string, string> {
  return {
    [SCROLL_SECTION_MARGIN_VARIABLE]: `${getScrollSectionMargin(insets)}px`,
    [SCROLL_SECTION_STICKY_INSET_VARIABLE]: `${insets.pinned}px`
  }
}
