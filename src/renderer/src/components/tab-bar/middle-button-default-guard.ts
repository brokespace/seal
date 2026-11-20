import type { MouseEvent as ReactMouseEvent } from 'react'

export function preventMiddleButtonDefault(event: ReactMouseEvent): void {
  if (event.button === 1) {
    // Cancel mouseup too: mousedown/auxclick alone cannot block Linux primary-selection paste into the next terminal.
    event.preventDefault()
  }
}

/** A middle click closes a tab on auxclick; `close` is null for a tab that stays (pinned). */
export function closeTabOnMiddleClick(event: ReactMouseEvent, close: (() => void) | null): void {
  if (event.button === 1) {
    event.preventDefault()
    event.stopPropagation()
    close?.()
  }
}
