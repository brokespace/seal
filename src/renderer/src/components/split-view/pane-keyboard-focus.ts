import { ITEM_SURFACE_PANE_ATTRIBUTE } from './ItemSurfaceSlot'
import { focusWorkspacePaneContent } from './pane-workspace-keyboard-focus'
import { ITEM_TAB_STRIP_ATTRIBUTE } from './split-view-drop-target'
import { SPLIT_VIEW_PANE_ATTRIBUTE } from './split-view-pane-size'
import { splitViewStore } from './split-view-store'
import { activeSplitViewItem } from './split-view-types'

const STRIP_CONTROL_SELECTOR = `[${ITEM_TAB_STRIP_ATTRIBUTE}] [role="tab"], [${ITEM_TAB_STRIP_ATTRIBUTE}] button`

/** A press or focus on a tab or a strip button is its own business: it acts on the pane itself. */
export function landsOnStripControl(target: EventTarget): boolean {
  return target instanceof Element && target.closest(STRIP_CONTROL_SELECTOR) !== null
}

// A surface that left its pane (behind a tab, or its pane drawn over) is found too: the keyboard does not stay there.
const PANE_CONTENT_SELECTOR = `[${SPLIT_VIEW_PANE_ATTRIBUTE}], [data-workspace-surface-id], [data-split-view-pane-body]`

const SURFACE_PRESS_END_EVENTS = ['pointerup', 'pointercancel', 'pointermove'] as const
let surfacePressPaneId: string | null = null

/**
 * A press inside a workspace places the keyboard itself, and a tab pressed there gives up when an
 * embedded page takes the keyboard before the release. The pane it focuses waits for the release.
 */
export function holdKeyboardFocusForSurfacePress(paneId: string): void {
  if (surfacePressPaneId !== null || splitViewStore.getState().focusedPaneId === paneId) {
    return
  }
  surfacePressPaneId = paneId
  const release = (event: PointerEvent): void => {
    // A release the window never saw arrives as a buttonless move.
    if (event.type === 'pointermove' && event.buttons !== 0) {
      return
    }
    for (const type of SURFACE_PRESS_END_EVENTS) {
      window.removeEventListener(type, release, true)
    }
    // After the release's own handlers, which bring a pressed tab to the front.
    setTimeout(() => {
      surfacePressPaneId = null
      if (splitViewStore.getState().focusedPaneId !== paneId) {
        return
      }
      // A pressed or dragged workspace tab holds the keyboard itself; the pane wants it in what is in front.
      const active = document.activeElement
      if (
        active instanceof HTMLElement &&
        active.matches('[data-tab-id]') &&
        active.closest(`[data-workspace-surface-pane-id="${CSS.escape(paneId)}"]`)
      ) {
        active.blur()
      }
      bringKeyboardFocusIntoFocusedPane(false)
    }, 0)
  }
  for (const type of SURFACE_PRESS_END_EVENTS) {
    window.addEventListener(type, release, true)
  }
}

const TAB_KEYBOARD_HOLD_MS = 1000
const MAX_KEYBOARD_RETAKES = 3

/**
 * A workspace that becomes the current one focuses its terminal. A tab or a strip button chosen
 * with Enter or Space keeps the keyboard, until the next key or press or for a second at most.
 */
export function keepKeyboardOnStripControl(control: HTMLElement): void {
  const takenBack = new WeakMap<Element, number>()
  const retake = (): void => {
    // After the focus has landed where it was sent.
    queueMicrotask(() => {
      const holder = document.activeElement
      if (!control.isConnected || holder === control) {
        return
      }
      const times = holder ? (takenBack.get(holder) ?? 0) : 0
      // What keeps taking the keyboard (a dialog that traps it) is left with it.
      if (times >= MAX_KEYBOARD_RETAKES) {
        stop()
        return
      }
      if (holder) {
        takenBack.set(holder, times + 1)
      }
      control.focus({ preventScroll: true })
    })
  }
  const stop = (): void => {
    clearTimeout(timer)
    control.removeEventListener('focusout', retake)
    window.removeEventListener('keydown', stop, true)
    window.removeEventListener('pointerdown', stop, true)
  }
  const timer = setTimeout(stop, TAB_KEYBOARD_HOLD_MS)
  control.addEventListener('focusout', retake)
  window.addEventListener('keydown', stop, true)
  window.addEventListener('pointerdown', stop, true)
}

const TAB_KEY_FOCUS_MS = 100
let tabKeyAt = Number.NEGATIVE_INFINITY
globalThis.window?.addEventListener(
  'keydown',
  (event) => {
    if (event.key === 'Tab') {
      tabKeyAt = performance.now()
    }
  },
  true
)

/**
 * A workspace asks for the keyboard a moment after its tab is chosen, and a terminal when it has
 * started. By then the user may be in another pane: focus that arrives in a pane that is not the
 * focused one, with no press and no Tab key behind it, is handed back and moves no pane focus.
 */
export function declineLateWorkspaceFocus(
  paneId: string,
  event: React.FocusEvent<HTMLElement>
): boolean {
  const { focusedPaneId } = splitViewStore.getState()
  if (focusedPaneId === null || focusedPaneId === paneId || surfacePressPaneId === paneId) {
    return false
  }
  const taker = event.target
  // A page takes the keyboard on a press the window never sees.
  if (taker.tagName === 'WEBVIEW' || performance.now() - tabKeyAt < TAB_KEY_FOCUS_MS) {
    return false
  }
  const holder = event.relatedTarget
  if (holder instanceof HTMLElement && holder.isConnected) {
    holder.focus({ preventScroll: true })
  } else {
    taker.blur()
    bringKeyboardFocusIntoFocusedPane(false)
  }
  return true
}

const keyboardPlaceInSurface = new WeakMap<HTMLElement, HTMLElement>()

/** Where the keyboard is inside a project: it returns there when the tab comes back. */
export function noteKeyboardInItemSurface(surface: HTMLElement, holder: HTMLElement): void {
  keyboardPlaceInSurface.set(surface, holder)
}

function focusItemSurface(surface: HTMLElement): void {
  const last = keyboardPlaceInSurface.get(surface)
  if (last?.isConnected && surface.contains(last)) {
    last.focus({ preventScroll: true })
  }
  // What held it may be disabled or folded away by now.
  if (document.activeElement !== last) {
    surface.focus({ preventScroll: true })
  }
}

/**
 * Keyboard focus belongs in the focused pane. Focusing a pane by shortcut or by navigation leaves
 * it in the pane that lost focus, and closing the tab that held it leaves it nowhere. A tab
 * pressed with the pointer asks for it outright, wherever it was.
 */
export function bringKeyboardFocusIntoPane(
  paneId: string,
  pane: HTMLElement,
  worktreeId: string | null,
  tabPressed: boolean
): void {
  if (surfacePressPaneId === paneId) {
    return
  }
  const active = document.activeElement
  const owner = active instanceof HTMLElement && active !== document.body ? active : null
  const content = owner?.closest(PANE_CONTENT_SELECTOR) ?? null
  // A workspace and a project are drawn over the pane, not in it.
  const inThisPane =
    content === pane ||
    content?.getAttribute('data-workspace-surface-pane-id') === paneId ||
    content?.getAttribute(ITEM_SURFACE_PANE_ATTRIBUTE) === paneId
  const stays = tabPressed
    ? inThisPane && owner !== null && !landsOnStripControl(owner)
    : owner !== null && (!content || inThisPane)
  if (stays) {
    return
  }
  const body = document.querySelector<HTMLElement>(
    `[${ITEM_SURFACE_PANE_ATTRIBUTE}="${CSS.escape(paneId)}"]`
  )
  if (body) {
    focusItemSurface(body)
    return
  }
  owner?.blur()
  if (worktreeId) {
    focusWorkspacePaneContent(paneId, worktreeId)
  }
}

/** Split view ended on this project: the keyboard its closed pane held, or nothing holds, comes to it. */
export function bringKeyboardFocusIntoSingleViewItem(surface: HTMLElement): void {
  const active = document.activeElement
  const owner = active instanceof HTMLElement && active !== document.body ? active : null
  const content = owner?.closest(PANE_CONTENT_SELECTOR) ?? null
  if (owner === null || (content !== null && content !== surface)) {
    focusItemSurface(surface)
  }
}

let keyboardHolderBeforeTabMenus: HTMLElement | null = null

/** A right click on another tab dismisses the open menu first, and the keyboard is on nothing as the next opens. */
export function noteKeyboardHolderBeforeTabMenu(): void {
  const active = document.activeElement
  if (
    active instanceof HTMLElement &&
    active !== document.body &&
    !active.closest('[role="menu"]')
  ) {
    keyboardHolderBeforeTabMenus = active
  }
}

/** A menu dismissed by a press returns no keyboard, and the menu that follows it has none to return. */
export function returnKeyboardLeftByTabMenus(): void {
  // After the menu's own return.
  queueMicrotask(() => {
    // The menu that took over returns it.
    if (document.querySelector('[role="menu"]')) {
      return
    }
    const holder = keyboardHolderBeforeTabMenus
    keyboardHolderBeforeTabMenus = null
    if (document.activeElement === document.body && holder?.isConnected) {
      holder.focus({ preventScroll: true })
    }
  })
}

/** A chord that moves pane focus asks for the pane: a field beside the grid gives the keyboard up. */
export function releaseKeyboardHeldBesidePanes(): void {
  const active = document.activeElement
  if (
    active instanceof HTMLElement &&
    active !== document.body &&
    !active.closest(PANE_CONTENT_SELECTOR)
  ) {
    active.blur()
  }
}

/** After a menu command or a press that moved pane focus: the keyboard goes where the focus went. */
export function bringKeyboardFocusIntoFocusedPane(tabPressed = true): void {
  const state = splitViewStore.getState()
  const paneId = state.focusedPaneId
  const pane = paneId
    ? document.querySelector<HTMLElement>(`[${SPLIT_VIEW_PANE_ATTRIBUTE}="${CSS.escape(paneId)}"]`)
    : null
  if (!paneId || !pane) {
    return
  }
  const active = activeSplitViewItem(state, paneId)
  bringKeyboardFocusIntoPane(
    paneId,
    pane,
    active?.kind === 'workspace' ? active.worktreeId : null,
    tabPressed
  )
}
