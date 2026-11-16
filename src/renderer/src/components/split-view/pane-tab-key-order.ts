import { ITEM_SURFACE_PANE_ATTRIBUTE } from './ItemSurfaceSlot'
import { ITEM_TAB_STRIP_ATTRIBUTE } from './split-view-drop-target'
import { SPLIT_VIEW_PANE_ATTRIBUTE } from './split-view-pane-size'

const TAB_STOP_SELECTOR =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

function isShownTabStop(element: HTMLElement): boolean {
  return element.tabIndex >= 0 && element.getClientRects().length > 0
}

function edgeTabStop(root: Element, edge: 'first' | 'last'): HTMLElement | undefined {
  const stops = [...root.querySelectorAll<HTMLElement>(TAB_STOP_SELECTOR)]
  return edge === 'first' ? stops.find(isShownTabStop) : stops.findLast(isShownTabStop)
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

function itemSurfaceOfPane(paneId: string | null): HTMLElement | null {
  return paneId === null
    ? null
    : document.querySelector<HTMLElement>(
        `[${ITEM_SURFACE_PANE_ATTRIBUTE}="${CSS.escape(paneId)}"]`
      )
}

/**
 * A session or a project is drawn over its pane from a layer that comes before every strip. The
 * Tab key leaving it goes where it would if it were in the pane: back to its strip, on to the next.
 */
export function bridgeTabKeyFromItemSurface(
  event: React.KeyboardEvent<HTMLElement>,
  paneId: string
): void {
  if (!isPlainTabKey(event)) {
    return
  }
  const surface = event.currentTarget
  const strip = document.querySelector(`[${ITEM_TAB_STRIP_ATTRIBUTE}="${CSS.escape(paneId)}"]`)
  const stripEnd = strip ? edgeTabStop(strip, 'last') : undefined
  if (!stripEnd) {
    return
  }
  if (event.shiftKey) {
    if (event.target === surface || event.target === edgeTabStop(surface, 'first')) {
      event.preventDefault()
      stripEnd.focus()
    }
  } else if (event.target === edgeTabStop(surface, 'last')) {
    // Not prevented: the key goes on from the strip's end, to the next pane's strip or out of the panes.
    stripEnd.focus()
  }
}

/** The other half: Tab from a pane's strip into the session or project in it, Shift+Tab into the pane before. */
export function bridgeTabKeyFromPaneStrip(
  event: React.KeyboardEvent<HTMLElement>,
  paneId: string
): void {
  const strip =
    event.target instanceof Element ? event.target.closest(`[${ITEM_TAB_STRIP_ATTRIBUTE}]`) : null
  if (!strip || !isPlainTabKey(event)) {
    return
  }
  let surface: HTMLElement | null = null
  if (!event.shiftKey) {
    surface = event.target === edgeTabStop(strip, 'last') ? itemSurfaceOfPane(paneId) : null
  } else if (event.target === edgeTabStop(strip, 'first')) {
    const panes = [
      ...document.querySelectorAll<HTMLElement>(`[${SPLIT_VIEW_PANE_ATTRIBUTE}]`)
    ].filter((pane) => pane.getClientRects().length > 0)
    const before = panes[panes.findIndex((pane) => pane.contains(strip)) - 1]
    surface = itemSurfaceOfPane(before?.getAttribute(SPLIT_VIEW_PANE_ATTRIBUTE) ?? null)
  }
  if (surface) {
    event.preventDefault()
    const stop = edgeTabStop(surface, event.shiftKey ? 'last' : 'first') ?? surface
    stop.focus()
  }
}
