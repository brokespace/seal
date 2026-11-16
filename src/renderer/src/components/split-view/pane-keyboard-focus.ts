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

/** After a menu command that moved pane focus: the keyboard goes where the focus went. */
export function bringKeyboardFocusIntoFocusedPane(): void {
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
    true
  )
}
