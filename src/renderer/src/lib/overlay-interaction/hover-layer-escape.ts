import { hasVisibleOverlay } from './visible-overlay'

/** Escapes whose only taker is a tooltip or a hover card closing itself. */
const hoverLayerOnlyEscapes = new WeakSet<Event>()

/**
 * Call from the `onEscapeKeyDown` of a layer that opens by pointing at something (a tooltip, a
 * hover card). Radix follows it with its own `preventDefault`, which makes the press look as
 * handled as one a dialog took; any later call is a real taker.
 */
export function noteHoverLayerEscape(event: KeyboardEvent): void {
  if (event.defaultPrevented) {
    return
  }
  hoverLayerOnlyEscapes.add(event)
  const preventDefault = event.preventDefault
  let radixCallPending = true
  event.preventDefault = () => {
    if (!radixCallPending) {
      hoverLayerOnlyEscapes.delete(event)
    }
    radixCallPending = false
    preventDefault.call(event)
  }
}

/**
 * Whether something above the page already used this Escape, for page-level handlers that run
 * after it. A tooltip or a hover card is a label, not a layer the user opened: the press that
 * closes it still belongs to the page, unless a dialog or menu under it is waiting for the next one.
 */
export function isEscapeHandledAbovePage(event: KeyboardEvent): boolean {
  return event.defaultPrevented && (!hoverLayerOnlyEscapes.has(event) || hasVisibleOverlay())
}
