import { useCallback, useEffect } from 'react'
import { CLOSE_ALL_CONTEXT_MENUS_EVENT } from '@/lib/overlay-interaction/close-all-context-menus'

export function useTabContextMenuOpening(
  onOpenChange: (open: boolean) => void,
  retirePendingActivation: () => void
): (open: boolean) => void {
  return useCallback(
    (open: boolean) => {
      if (open) {
        retirePendingActivation()
      }
      onOpenChange(open)
    },
    [onOpenChange, retirePendingActivation]
  )
}

/** A tab's menu closes when another context menu opens, and when the window loses focus. */
export function useTabContextMenuDismissal(
  menuOpen: boolean,
  setMenuOpen: (open: boolean) => void
): void {
  useEffect(() => {
    const closeMenu = (): void => setMenuOpen(false)
    window.addEventListener(CLOSE_ALL_CONTEXT_MENUS_EVENT, closeMenu)
    return () => window.removeEventListener(CLOSE_ALL_CONTEXT_MENUS_EVENT, closeMenu)
  }, [setMenuOpen])

  // Why: webview clicks miss the renderer pointerdown Radix uses for outside-click, so dismiss on window blur instead.
  useEffect(() => {
    if (!menuOpen) {
      return
    }
    const dismiss = (): void => setMenuOpen(false)
    window.addEventListener('blur', dismiss)
    return () => window.removeEventListener('blur', dismiss)
  }, [menuOpen, setMenuOpen])
}
