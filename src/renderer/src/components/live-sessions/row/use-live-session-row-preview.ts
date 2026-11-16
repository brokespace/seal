import React from 'react'

const OPEN_DELAY_MS = 500
const CLOSE_DELAY_MS = 80

/** Row menus open anywhere: no row previews beside a menu, whichever row it belongs to. */
let openRowMenus = 0
/** Closes the one preview on screen: another row's preview, or any row's menu, takes its place. */
let closeShownPreview: (() => void) | null = null

type RowPointerHandler = React.PointerEventHandler<HTMLDivElement>
type RowFocusHandler = React.FocusEventHandler<HTMLDivElement>

export type LiveSessionRowPreview = {
  open: boolean
  row: React.RefObject<HTMLDivElement | null>
  card: React.RefObject<HTMLDivElement | null>
  /** The hover card may ask to close (Escape, the pointer leaving the card); it never opens. */
  onCardOpenChange: (open: boolean) => void
  /** Either of the row's menus opened or closed. */
  onMenuOpenChange: (open: boolean) => void
  rowHandlers: {
    onPointerEnter: RowPointerHandler
    onPointerMove: RowPointerHandler
    onPointerLeave: RowPointerHandler
    onPointerDown: RowPointerHandler
    onFocus: RowFocusHandler
    onBlur: RowFocusHandler
  }
}

/**
 * When a session row shows its preview: after half a second under the pointer or under keyboard
 * focus, one row at a time, never beside a row menu.
 *
 * Why not the hover card's own timers: they outlive the hover or focus that started them and a
 * newer one does not cancel them, so a preview opened early, after the pointer had left, or twice.
 */
export function useLiveSessionRowPreview(): LiveSessionRowPreview {
  const [open, setOpen] = React.useState(false)
  const row = React.useRef<HTMLDivElement>(null)
  const card = React.useRef<HTMLDivElement>(null)
  const openMenus = React.useRef(0)
  // From a press or a menu's opening until the pointer next enters the row or focus leaves it:
  // a closing menu hands focus back to the row, which is not the user coming to it.
  const held = React.useRef(false)
  // Focus that arrived by the keyboard asks for the preview; a click's focus does not.
  const focusAsks = React.useRef(false)
  const openTimer = React.useRef<number | null>(null)
  const closeTimer = React.useRef<number | null>(null)

  const cancelOpening = (): void => {
    if (openTimer.current !== null) {
      window.clearTimeout(openTimer.current)
      openTimer.current = null
    }
  }
  const pointedAt = (): boolean => row.current?.matches(':hover') === true
  const blocked = (): boolean => held.current || openRowMenus > 0
  const arm = (restart: boolean): void => {
    if (blocked() || (openTimer.current !== null && !restart)) {
      return
    }
    cancelOpening()
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null
      if (!blocked() && (pointedAt() || focusAsks.current)) {
        setOpen(true)
      }
    }, OPEN_DELAY_MS)
  }
  const release = (): void => {
    if (openMenus.current === 0) {
      held.current = false
    }
  }
  // Why the row closes it too: the card only closes what it knows is open, and the pointer can leave before that.
  const leave = (stillWanted: boolean): void => {
    if (!stillWanted) {
      cancelOpening()
    }
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current)
    }
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null
      if (!pointedAt() && !focusAsks.current && card.current?.matches(':hover') !== true) {
        setOpen(false)
      }
    }, CLOSE_DELAY_MS)
  }

  React.useEffect(() => {
    if (!open) {
      return
    }
    const close = (): void => setOpen(false)
    closeShownPreview?.()
    closeShownPreview = close
    return () => {
      if (closeShownPreview === close) {
        closeShownPreview = null
      }
    }
  }, [open])

  // A keyboard preview outlives the pointer: it must not stay beside a row scrolled out of sight.
  React.useEffect(() => {
    if (!open) {
      return
    }
    const closeWhenRowHidden = (): void => {
      const box = row.current?.getBoundingClientRect()
      const shown = box && document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
      // Pinned headers cover a row without clipping it: only what is drawn there can tell.
      if (!shown || !(row.current?.contains(shown) || card.current?.contains(shown))) {
        focusAsks.current = false
        setOpen(false)
      }
    }
    window.addEventListener('scroll', closeWhenRowHidden, { capture: true, passive: true })
    return () => window.removeEventListener('scroll', closeWhenRowHidden, true)
  }, [open])

  React.useEffect(
    () => () => {
      openRowMenus = Math.max(0, openRowMenus - openMenus.current)
      window.clearTimeout(openTimer.current ?? undefined)
      window.clearTimeout(closeTimer.current ?? undefined)
    },
    []
  )

  return {
    open,
    row,
    card,
    onCardOpenChange: (next) => {
      if (!next) {
        setOpen(false)
      }
    },
    onMenuOpenChange: (menuOpen) => {
      const change = menuOpen ? 1 : -1
      openMenus.current = Math.max(0, openMenus.current + change)
      openRowMenus = Math.max(0, openRowMenus + change)
      held.current = true
      cancelOpening()
      setOpen(false)
      if (menuOpen) {
        closeShownPreview?.()
      }
    },
    rowHandlers: {
      onPointerEnter: (event) => {
        if (event.pointerType !== 'touch') {
          release()
          arm(true)
        }
      },
      // A pointer already resting here when a menu elsewhere closed has no entry to start from.
      onPointerMove: (event) => {
        if (event.pointerType !== 'touch' && !open) {
          arm(false)
        }
      },
      onPointerLeave: () => leave(focusAsks.current),
      onPointerDown: () => {
        held.current = true
        cancelOpening()
      },
      onFocus: (event) => {
        if (event.target !== event.currentTarget) {
          return
        }
        focusAsks.current = !held.current && event.currentTarget.matches(':focus-visible')
        if (focusAsks.current) {
          arm(true)
        }
      },
      onBlur: (event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          focusAsks.current = false
          release()
          leave(pointedAt())
        }
      }
    }
  }
}
