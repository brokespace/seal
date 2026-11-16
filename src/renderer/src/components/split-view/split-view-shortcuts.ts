import { useAppStore } from '@/store/index'
import { hasVisibleOverlay } from '@/lib/overlay-interaction/visible-overlay'
import type { SplitViewActionId } from '../../../../shared/keybindings/definitions-split-view'
import {
  closeSplitViewPane,
  focusNeighbourSplitViewPane,
  placeItemsInSplitView,
  toggleSplitViewPaneMaximized
} from './split-view-commands'
import { releaseKeyboardHeldBesidePanes } from './pane-keyboard-focus'
import { isSplitViewShowing } from './split-view-showing'
import { splitViewStore } from './split-view-store'
import { activeSplitViewItem, type SplitViewEdge } from './split-view-types'

function isSplitViewOnScreen(): boolean {
  return isSplitViewShowing() && useAppStore.getState().activeModal === 'none'
}

/** False leaves the key to what has focus: no grid is on screen, or a dialog or menu is over it. */
export function canRunSplitViewShortcut(): boolean {
  return isSplitViewOnScreen() && !hasVisibleOverlay({ ignoreDismissed: true })
}

function moveFocusedTabToNewPane(edge: SplitViewEdge): void {
  const state = splitViewStore.getState()
  const paneId = state.focusedPaneId
  const item = paneId ? activeSplitViewItem(state, paneId) : null
  // A pane's only tab has nothing to split from.
  if (paneId && item && state.panes[paneId].tabs.length > 1) {
    placeItemsInSplitView([item], { paneId, zone: edge })
  }
}

export function runSplitViewShortcut(actionId: SplitViewActionId): void {
  switch (actionId) {
    case 'splitView.focusNextPane':
    case 'splitView.focusPreviousPane':
      if (focusNeighbourSplitViewPane(actionId === 'splitView.focusNextPane' ? 1 : -1)) {
        releaseKeyboardHeldBesidePanes()
      }
      return
    case 'splitView.toggleMaximize':
      toggleSplitViewPaneMaximized()
      return
    case 'splitView.moveTabRight':
      moveFocusedTabToNewPane('right')
      return
    case 'splitView.moveTabDown':
      moveFocusedTabToNewPane('down')
      return
    case 'splitView.closePane': {
      const paneId = splitViewStore.getState().focusedPaneId
      if (paneId) {
        closeSplitViewPane(paneId)
      }
    }
  }
}

/**
 * Main takes these chords ahead of editors, terminals and embedded pages, so it has to know when
 * they would run; otherwise it would swallow them. Returns the unsubscribe.
 */
export function reportSplitViewShowingToMain(): () => void {
  let reported: boolean | null = null
  const report = (): void => {
    // Stores only: an open dialog is not in them, and is checked when the chord arrives.
    const showing = isSplitViewOnScreen()
    if (showing !== reported) {
      reported = showing
      window.api.ui.setSplitViewShowing(showing)
    }
  }
  report()
  const unsubscribeGrid = splitViewStore.subscribe(report)
  const unsubscribeApp = useAppStore.subscribe(report)
  return () => {
    unsubscribeGrid()
    unsubscribeApp()
  }
}
