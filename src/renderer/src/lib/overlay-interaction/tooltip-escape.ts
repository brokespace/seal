import { hasVisibleOverlay } from './visible-overlay'

/** Escapes whose only taker is a tooltip closing itself. */
const tooltipOnlyEscapes = new WeakSet<Event>()

/**
 * Call from a tooltip's `onEscapeKeyDown`. Radix follows it with its own `preventDefault`, which
 * makes the press look as handled as one a dialog took; any later call is a real taker.
 */
export function noteTooltipEscape(event: KeyboardEvent): void {
  if (event.defaultPrevented) {
    return
  }
  tooltipOnlyEscapes.add(event)
  const preventDefault = event.preventDefault
  let radixCallPending = true
  event.preventDefault = () => {
    if (!radixCallPending) {
      tooltipOnlyEscapes.delete(event)
    }
    radixCallPending = false
    preventDefault.call(event)
  }
}

/**
 * Whether something above the page already used this Escape, for page-level handlers that run
 * after it. A tooltip is a label, not a layer: the press that closes it still belongs to the page,
 * unless a dialog or menu under the tooltip is waiting for the next one.
 */
export function isEscapeHandledAbovePage(event: KeyboardEvent): boolean {
  return event.defaultPrevented && (!tooltipOnlyEscapes.has(event) || hasVisibleOverlay())
}
