import { ITEM_SURFACE_PANE_ATTRIBUTE } from './ItemSurfaceSlot'
import { ITEM_TAB_STRIP_ATTRIBUTE } from './split-view-drop-target'

/**
 * In a grid a session or a project is drawn from a layer that comes before every pane strip, so
 * the browser's own Tab order is all contents first and all strips after. These put back the
 * order a reader expects: a strip, then what it shows, then the next strip. A single view needs
 * none of it: its strip already stands before its content.
 */

const TAB_STOP_SELECTOR =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
const GUARD_ATTRIBUTE = 'data-pane-tab-order-guard'

type GuardEdge = 'entry' | 'exit'

function isShown(element: HTMLElement): boolean {
  return element.getClientRects().length > 0
}

function edgeTabStop(root: Element, edge: 'first' | 'last'): HTMLElement | undefined {
  const isStop = (element: HTMLElement): boolean => element.tabIndex >= 0 && isShown(element)
  const stops = [...root.querySelectorAll<HTMLElement>(TAB_STOP_SELECTOR)]
  return edge === 'first' ? stops.find(isStop) : stops.findLast(isStop)
}

function isPlainTabKey(event: React.KeyboardEvent): boolean {
  return (
    event.key === 'Tab' &&
    !event.defaultPrevented &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey
  )
}

/** A menu drawn outside its strip or surface still sends its keys through it. */
function isInside(event: React.KeyboardEvent<HTMLElement>): boolean {
  return event.target instanceof Node && event.currentTarget.contains(event.target)
}

/** The strips of the grid's panes; the agent-session page's own strip names no pane. */
function paneStrips(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(`[${ITEM_TAB_STRIP_ATTRIBUTE}]`)].filter(
    (strip) => strip.getAttribute(ITEM_TAB_STRIP_ATTRIBUTE) !== '' && isShown(strip)
  )
}

/** The session or project a pane's strip has in front; a workspace pane has none here. */
function surfaceOfStrip(strip: Element): HTMLElement | undefined {
  const paneId = strip.getAttribute(ITEM_TAB_STRIP_ATTRIBUTE)
  if (!paneId) {
    return undefined
  }
  const selector = `[${ITEM_SURFACE_PANE_ATTRIBUTE}="${CSS.escape(paneId)}"]`
  return [...document.querySelectorAll<HTMLElement>(selector)].find(isShown)
}

function stripOfSurface(surface: Element): HTMLElement | undefined {
  const paneId = surface.getAttribute(ITEM_SURFACE_PANE_ATTRIBUTE)
  return paneId
    ? paneStrips().find((strip) => strip.getAttribute(ITEM_TAB_STRIP_ATTRIBUTE) === paneId)
    : undefined
}

function guard(edge: GuardEdge): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[${GUARD_ATTRIBUTE}="${edge}"]`)
}

/** A key pressed among the panes leaves them past the guard; only what comes in stops on it. */
function skipGuardForThisKey(edge: GuardEdge): void {
  const element = guard(edge)
  if (element) {
    element.tabIndex = -1
    setTimeout(() => {
      element.tabIndex = 0
    }, 0)
  }
}

let passingGuard = false

export function bridgeTabKeyFromItemSurface(event: React.KeyboardEvent<HTMLElement>): void {
  if (!isPlainTabKey(event) || !isInside(event)) {
    return
  }
  const surface = event.currentTarget
  const strip = stripOfSurface(surface)
  const stripEnd = strip ? edgeTabStop(strip, 'last') : undefined
  if (!stripEnd) {
    return
  }
  skipGuardForThisKey(event.shiftKey ? 'entry' : 'exit')
  if (event.shiftKey) {
    if (event.target === surface || event.target === edgeTabStop(surface, 'first')) {
      event.preventDefault()
      stripEnd.focus()
    }
  } else if (event.target === edgeTabStop(surface, 'last')) {
    // The key then moves on from the strip's end: to the next strip, or out of the panes.
    stripEnd.focus()
  }
}

export function bridgeTabKeyFromItemStrip(event: React.KeyboardEvent<HTMLElement>): void {
  if (!isPlainTabKey(event) || !isInside(event)) {
    return
  }
  const strip = event.currentTarget
  if (!strip.getAttribute(ITEM_TAB_STRIP_ATTRIBUTE)) {
    return
  }
  skipGuardForThisKey(event.shiftKey ? 'entry' : 'exit')
  if (!event.shiftKey) {
    const surface = event.target === edgeTabStop(strip, 'last') ? surfaceOfStrip(strip) : undefined
    if (surface) {
      event.preventDefault()
      const stop = edgeTabStop(surface, 'first') ?? surface
      stop.focus()
    }
    return
  }
  if (event.target !== edgeTabStop(strip, 'first')) {
    return
  }
  const strips = paneStrips()
  const before = strips[strips.indexOf(strip) - 1]
  if (!before) {
    // Out of the panes backward: from the entry guard the key moves to what precedes every surface.
    passingGuard = true
    guard('entry')?.focus()
    passingGuard = false
    return
  }
  const surface = surfaceOfStrip(before)
  if (surface) {
    event.preventDefault()
    const stop = edgeTabStop(surface, 'last') ?? surface
    stop.focus()
  }
}

function enterPanes(edge: GuardEdge): void {
  if (passingGuard) {
    return
  }
  const strips = paneStrips()
  if (edge === 'entry') {
    const first = strips[0]
    const stop = first ? edgeTabStop(first, 'first') : undefined
    stop?.focus()
    return
  }
  const last = strips.at(-1)
  const surface = last ? surfaceOfStrip(last) : undefined
  const stop = surface
    ? (edgeTabStop(surface, 'last') ?? surface)
    : last && edgeTabStop(last, 'last')
  stop?.focus()
}

/**
 * Where Tab comes into a grid. The entry guard stands before every surface and sends the key to
 * the first strip; the exit guard stands after every strip and sends Shift+Tab to the end of
 * what the last strip shows.
 */
export function PaneTabOrderGuard({ edge }: { edge: GuardEdge }): React.JSX.Element {
  return (
    <span
      {...{ [GUARD_ATTRIBUTE]: edge }}
      tabIndex={0}
      aria-hidden
      className="pointer-events-auto sr-only"
      onFocus={() => enterPanes(edge)}
    />
  )
}
