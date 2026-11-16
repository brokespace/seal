import { useEffect } from 'react'
import { useAppStore } from '@/store/index'
import { hasVisibleOverlay } from '@/lib/overlay-interaction/visible-overlay'
import {
  offerSidebarSectionKeyboardCursor,
  type SidebarSectionEntryEdge
} from '@/components/sidebar/sidebar-section-keyboard-handoff'
import { getExecutionHostIdFromWorktreeHostIdentity } from '../../../../../shared/worktree/host-qualified-identity'
import { liveSessionMarksStore } from '../live-session-marks-store'
import { scrollSidebarSessionRowIntoView } from './session-row-reveal'
import {
  SIDEBAR_LIST as LIST,
  SIDEBAR_SESSION_ROW,
  UNASSIGNED_SESSIONS,
  UNASSIGNED_SESSIONS_TOGGLE
} from './sidebar-session-row-dom'

const SESSIONS = `${LIST}, ${UNASSIGNED_SESSIONS}`
const WORKSPACE_ROWS_SECTION = '[data-worktree-sidebar-content]'
const WORKSPACE_OPTION = '[role="option"][data-worktree-id]'
const CARD = '[data-worktree-card-surface]'
// The lines that unfold ended sessions and the Unassigned group are stops too, or the keyboard could not open them.
const SESSION_ROW = `[data-workspace-session-rows] :is([data-live-session-row], [data-workspace-sessions-finished-toggle]), ${UNASSIGNED_SESSIONS_TOGGLE}`
const TAB_STOP_ROW = `${SIDEBAR_SESSION_ROW}, ${UNASSIGNED_SESSIONS_TOGGLE}`
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

/**
 * A row the keyboard moved to is marked while it holds it, as the list is while its own arrow
 * keys move it: a terminal that regains the window then leaves the keyboard where it is.
 */
function markRowForKeyboard(row: HTMLElement): void {
  row.setAttribute('data-keyboard-navigation', '')
  row.addEventListener('blur', () => row.removeAttribute('data-keyboard-navigation'), {
    once: true
  })
}

export function focusRowForKeyboard(row: HTMLElement): void {
  // Why not the browser's focus scroll: it cannot see the headers pinned over the rows.
  row.focus({ preventScroll: true })
  if (document.activeElement === row) {
    markRowForKeyboard(row)
  }
}

function focusSessionRow(row: HTMLElement | undefined): boolean {
  if (!row) {
    return false
  }
  focusRowForKeyboard(row)
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

function unassignedStops(group: Element | null): HTMLElement[] {
  return group ? Array.from(group.querySelectorAll<HTMLElement>(SESSION_ROW)) : []
}

/** The Unassigned group takes the cursor a neighbouring sidebar section offers, on its first or last stop. */
export function enterUnassignedSessions(
  group: Element | null,
  edge: SidebarSectionEntryEdge
): boolean {
  const stops = unassignedStops(group)
  return focusSessionRow(edge === 'first' ? stops[0] : stops.at(-1))
}

function moveInUnassignedSessions(group: Element, row: HTMLElement, event: KeyboardEvent): boolean {
  const stops = unassignedStops(group)
  const up = event.key === 'ArrowUp'
  if (!focusSessionRow(stops[stops.indexOf(row) + (up ? -1 : 1)])) {
    // Past its own ends the cursor moves on through the sidebar list, or stays when no workspace takes it.
    offerSidebarSectionKeyboardCursor(group, up ? 'up' : 'down', event.repeat)
  }
  return true
}

function moveFromSessionRow(row: HTMLElement, event: KeyboardEvent): boolean {
  const list = row.closest<HTMLElement>(LIST)
  const card = row.closest(CARD)
  // A stop no card holds is the Unassigned group's, a section of its own after the workspaces.
  const group = card ? null : row.closest(UNASSIGNED_SESSIONS)
  const sessions = list ?? group
  if (!sessions || (!card && !group)) {
    return false
  }
  if (event.key === 'Home' || event.key === 'End') {
    const rows = Array.from(sessions.querySelectorAll<HTMLElement>(SESSION_ROW))
    return focusSessionRow(event.key === 'Home' ? rows[0] : rows.at(-1))
  }
  if (!list || !card) {
    return group !== null && moveInUnassignedSessions(group, row, event)
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

/** Escape ends selecting from anywhere in the list: its menus hand focus back to their button, not to a row. */
function endSelecting(target: HTMLElement): boolean {
  if (
    liveSessionMarksStore.getState().picked === null ||
    target.matches('input, textarea, [contenteditable="true"]')
  ) {
    return false
  }
  liveSessionMarksStore.setPicked(null)
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
  // Keys typed anywhere else in the window are not the sidebar's.
  if (!target.closest(SESSIONS)) {
    return
  }
  if (hasVisibleOverlay() || useAppStore.getState().activeModal !== 'none') {
    return
  }
  const handled =
    event.key === 'Escape'
      ? endSelecting(target)
      : target.matches(LIST)
        ? moveFromList(target, event)
        : // Keys from a control inside a row belong to its own handlers.
          target.matches(SESSION_ROW) && moveFromSessionRow(target, event)
  if (handled) {
    event.preventDefault()
    // Why: the list's own handler would also move on to the next workspace.
    event.stopPropagation()
  }
}

let tabbing = false

function onTabKey(event: KeyboardEvent): void {
  tabbing =
    event.type === 'keydown' &&
    event.key === 'Tab' &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
}

/** A row Tab lands on holds the keyboard as one the arrow keys moved to does, clear of the pinned headers. */
function onFocusIn(event: FocusEvent): void {
  const row = event.target
  if (!tabbing || !(row instanceof HTMLElement) || !row.matches(TAB_STOP_ROW)) {
    return
  }
  markRowForKeyboard(row)
  scrollSidebarSessionRowIntoView(row)
}

/** Makes workspaces and the session rows under them one arrow-key list, while mounted. */
export function useSidebarSessionRowKeyboard(): void {
  useEffect(() => {
    // Why capture: this runs ahead of the list's own key handler, which knows nothing of session rows.
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('keydown', onTabKey, true)
    document.addEventListener('keyup', onTabKey, true)
    document.addEventListener('focusin', onFocusIn)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('keydown', onTabKey, true)
      document.removeEventListener('keyup', onTabKey, true)
      document.removeEventListener('focusin', onFocusIn)
    }
  }, [])
}
