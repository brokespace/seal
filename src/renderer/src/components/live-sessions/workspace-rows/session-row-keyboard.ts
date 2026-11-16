import { useEffect } from 'react'
import { useAppStore } from '@/store/index'
import { hasVisibleOverlay } from '@/lib/overlay-interaction/visible-overlay'
import { offerSidebarSectionKeyboardCursor } from '@/components/sidebar/sidebar-section-keyboard-handoff'
import { getExecutionHostIdFromWorktreeHostIdentity } from '../../../../../shared/worktree/host-qualified-identity'
import { liveSessionMarksStore } from '../live-session-marks-store'
import { scrollSidebarSessionRowIntoView } from './session-row-reveal'

const LIST = '[data-worktree-sidebar]'
const WORKSPACE_ROWS_SECTION = '[data-worktree-sidebar-content]'
const WORKSPACE_OPTION = '[role="option"][data-worktree-id]'
const CARD = '[data-worktree-card-surface]'
// The line that unfolds a workspace's ended sessions is a stop too, or the keyboard could not open it.
const SESSION_ROW =
  '[data-workspace-session-rows] :is([data-live-session-row], [data-workspace-sessions-finished-toggle])'
const KEYS: ReadonlySet<string> = new Set(['ArrowUp', 'ArrowDown', 'Home', 'End', 'Escape'])

// Why closest(): a card can hold other workspaces' cards, whose rows are not its own.
function sessionRowsOf(card: Element): HTMLElement[] {
  return Array.from(card.querySelectorAll<HTMLElement>(SESSION_ROW)).filter(
    (row) => row.closest(CARD) === card
  )
}

/** The workspace the list's own arrow keys would move on from. */
function cursorOption(list: HTMLElement): HTMLElement | null {
  const id = list.getAttribute('aria-activedescendant')
  const named = id ? document.getElementById(id) : null
  return named && list.contains(named)
    ? named
    : list.querySelector<HTMLElement>('[role="option"][aria-current="page"]')
}

function focusSessionRow(row: HTMLElement | undefined): boolean {
  if (!row) {
    return false
  }
  // Why not the browser's focus scroll: it cannot see the headers pinned over the rows.
  row.focus({ preventScroll: true })
  scrollSidebarSessionRowIntoView(row)
  return true
}

/** Hand the keyboard back to the list, with its cursor on this card's workspace. */
function enterWorkspaceCard(list: HTMLElement, card: Element): void {
  // Why before switching: only a list that holds focus keeps it from the terminal of the workspace it switches to.
  list.focus({ preventScroll: true })
  list.setAttribute('data-keyboard-navigation', '')
  const option = card.closest<HTMLElement>(WORKSPACE_OPTION)
  const worktreeId = option?.dataset.worktreeId
  if (!option || !worktreeId) {
    return
  }
  if (option !== cursorOption(list) || option.getAttribute('aria-current') !== 'page') {
    // Why a press: the cursor is the list's own selection, which only a press on the row moves; switching workspace alone leaves it behind.
    option.click()
  }
  useAppStore.getState().revealWorktreeInSidebar(worktreeId, {
    behavior: 'auto',
    executionHostId: getExecutionHostIdFromWorktreeHostIdentity(
      option.dataset.worktreeHostIdentity ?? ''
    ),
    rowKey: option.dataset.worktreeRowKey
  })
}

function moveFromList(list: HTMLElement, event: KeyboardEvent): boolean {
  // A held key only previews workspaces; the switch that follows its release would pull focus off a session row.
  if (event.repeat || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) {
    return false
  }
  const card = cursorOption(list)?.querySelector(CARD)
  if (!card) {
    return false
  }
  if (event.key === 'ArrowDown') {
    return focusSessionRow(sessionRowsOf(card)[0])
  }
  const cards = Array.from(list.querySelectorAll(CARD))
  const previous = cards[cards.indexOf(card) - 1]
  return previous ? focusSessionRow(sessionRowsOf(previous).at(-1)) : false
}

function moveFromSessionRow(row: HTMLElement, event: KeyboardEvent): boolean {
  const list = row.closest<HTMLElement>(LIST)
  const card = row.closest(CARD)
  if (!list || !card) {
    return false
  }
  if (event.key === 'Escape') {
    if (liveSessionMarksStore.getState().picked === null) {
      return false
    }
    liveSessionMarksStore.setPicked(null)
    return true
  }
  if (event.key === 'Home' || event.key === 'End') {
    const rows = Array.from(list.querySelectorAll<HTMLElement>(SESSION_ROW))
    return focusSessionRow(event.key === 'Home' ? rows[0] : rows.at(-1))
  }
  const rows = sessionRowsOf(card)
  const at = rows.indexOf(row)
  if (event.key === 'ArrowUp') {
    if (!focusSessionRow(rows[at - 1])) {
      enterWorkspaceCard(list, card)
    }
    return true
  }
  if (focusSessionRow(rows[at + 1])) {
    return true
  }
  const cards = Array.from(list.querySelectorAll(CARD))
  const next = cards[cards.indexOf(card) + 1]
  if (next) {
    enterWorkspaceCard(list, next)
  } else {
    // Past the last workspace the cursor moves on through the sidebar list, as it does from a workspace row.
    offerSidebarSectionKeyboardCursor(
      list.querySelector(WORKSPACE_ROWS_SECTION),
      'down',
      event.repeat
    )
  }
  return true
}

function onKeyDown(event: KeyboardEvent): void {
  if (!KEYS.has(event.key)) {
    return
  }
  const target = event.target
  if (
    !(target instanceof HTMLElement) ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.shiftKey ||
    event.defaultPrevented ||
    event.isComposing
  ) {
    return
  }
  const onList = target.matches(LIST)
  // Keys from a control inside a row, or from an Active agents row, belong to their own handlers.
  if (!onList && !target.matches(SESSION_ROW)) {
    return
  }
  if (hasVisibleOverlay() || useAppStore.getState().activeModal !== 'none') {
    return
  }
  if (onList ? moveFromList(target, event) : moveFromSessionRow(target, event)) {
    event.preventDefault()
    // Why: the list's own handler would also move on to the next workspace.
    event.stopPropagation()
  }
}

/** Makes workspaces and the session rows under them one arrow-key list, while mounted. */
export function useSidebarSessionRowKeyboard(): void {
  useEffect(() => {
    // Why capture: this runs ahead of the list's own key handler, which knows nothing of session rows.
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [])
}
