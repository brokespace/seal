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

const PANE_CONTENT_SELECTOR = `[${SPLIT_VIEW_PANE_ATTRIBUTE}], [data-workspace-surface-pane-id]`

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
  const inThisPane =
    content === pane || content?.getAttribute('data-workspace-surface-pane-id') === paneId
  const stays = tabPressed
    ? inThisPane && owner !== null && !landsOnStripControl(owner)
    : owner !== null && (!content || inThisPane)
  if (stays) {
    return
  }
  const body = pane.querySelector<HTMLElement>('[data-split-view-pane-body]')
  if (body) {
    body.focus({ preventScroll: true })
    return
  }
  owner?.blur()
  if (worktreeId) {
    focusWorkspacePaneContent(paneId, worktreeId)
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
