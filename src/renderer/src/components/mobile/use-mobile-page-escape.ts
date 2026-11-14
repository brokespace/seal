import { useEffect } from 'react'
import { isEscapeHandledAbovePage } from '@/lib/overlay-interaction/tooltip-escape'

function isEditableElement(target: EventTarget | null): target is HTMLElement {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}

export function useMobilePageEscape(onClose: () => void): void {
  // Why: mirror Automations/Tasks — Esc first exits field focus, then closes the page.
  useEffect(() => {
    // Why: the Escape that closed the page above this one (Settings) is still travelling when this page mounts.
    const listeningSince = performance.now()
    function onKeyDown(event: KeyboardEvent): void {
      if (
        event.key !== 'Escape' ||
        isEscapeHandledAbovePage(event) ||
        event.timeStamp < listeningSince
      ) {
        return
      }
      const target = event.target
      if (!(target instanceof HTMLElement)) {
        return
      }
      if (isEditableElement(target)) {
        event.preventDefault()
        target.blur()
        return
      }
      event.preventDefault()
      onClose()
    }
    // Why: bubble phase lets Radix popovers/selects consume Escape first.
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])
}
