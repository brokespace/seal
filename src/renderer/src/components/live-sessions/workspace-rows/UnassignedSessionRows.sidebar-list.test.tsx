// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  offerSidebarSectionKeyboardCursor,
  SIDEBAR_KEYBOARD_SECTION_PROPS,
  useSidebarSectionKeyboardEntry,
  type SidebarSectionEntryEdge
} from '@/components/sidebar/sidebar-section-keyboard-handoff'
import { liveSessionMarksStore } from '../live-session-marks-store'
import { SAMPLE_NOW, sampleLiveSession } from '../live-session.test-fixture'
import { sidebarSessionFilterStore } from './sidebar-session-filter-store'
import SidebarSessions from './SidebarSessions'

const SESSIONS = [
  sampleLiveSession('first', { status: 'working', lastActivityAt: SAMPLE_NOW - 1_000 }),
  sampleLiveSession('last', { status: 'working', lastActivityAt: SAMPLE_NOW - 2_000 }),
  sampleLiveSession('ended', { status: 'done', alive: false, lastActivityAt: SAMPLE_NOW - 3_000 })
]

const saveUi = vi.fn(async () => {})
const initialState = useAppStore.getState()

function WorkspaceRows({
  onEnter
}: {
  onEnter: (edge: SidebarSectionEntryEdge, held: boolean) => boolean
}): React.JSX.Element {
  const rows = useRef<HTMLDivElement>(null)
  useSidebarSectionKeyboardEntry(() => rows.current, onEnter)
  return <div ref={rows} data-workspace-rows {...SIDEBAR_KEYBOARD_SECTION_PROPS} />
}

/** The sidebar's one list: the workspace rows, then the Unassigned group, in one scroll container. */
function SidebarList({
  onEnterWorkspaces
}: {
  onEnterWorkspaces: (edge: SidebarSectionEntryEdge, held: boolean) => boolean
}): React.JSX.Element {
  return (
    <TooltipProvider>
      <div data-worktree-sidebar>
        <WorkspaceRows onEnter={onEnterWorkspaces} />
        <SidebarSessions />
      </div>
    </TooltipProvider>
  )
}

function sessionRows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-live-session-row]')]
}

function groupLabel(): HTMLElement {
  return document.querySelector<HTMLElement>('[data-unassigned-sessions-toggle]')!
}

async function renderList(
  onEnterWorkspaces: (edge: SidebarSectionEntryEdge, held: boolean) => boolean = () => true
): Promise<void> {
  render(<SidebarList onEnterWorkspaces={onEnterWorkspaces} />)
  await waitFor(() => expect(sessionRows()).toHaveLength(2))
}

beforeEach(() => {
  vi.useFakeTimers({ now: SAMPLE_NOW, toFake: ['Date'] })
  saveUi.mockClear()
  vi.stubGlobal('api', {
    ui: { set: saveUi },
    liveSessions: {
      onEvent: () => () => {},
      onMessage: () => () => {},
      snapshot: async () => ({ revision: 1, sessions: SESSIONS, hostErrors: {} }),
      messages: async () => []
    }
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  act(() => sidebarSessionFilterStore.clear())
  useAppStore.setState(initialState, true)
})

it('lists the sessions no workspace holds under one label, the ended ones behind their line', async () => {
  await renderList()

  expect(groupLabel().getAttribute('aria-expanded')).toBe('true')
  expect(sessionRows().map((row) => row.dataset.liveSessionRow)).toEqual(['first', 'last'])
  expect(document.querySelector('[data-workspace-sessions-finished-toggle]')).not.toBeNull()
})

it('moves the arrow-key cursor from its label through its rows and on to the workspaces', async () => {
  const onEnterWorkspaces = vi.fn(() => true)
  await renderList(onEnterWorkspaces)
  const [first, last] = sessionRows()
  const finished = document.querySelector<HTMLElement>('[data-workspace-sessions-finished-toggle]')!
  groupLabel().focus()

  fireEvent.keyDown(groupLabel(), { key: 'ArrowDown' })
  expect(document.activeElement).toBe(first)
  fireEvent.keyDown(first, { key: 'ArrowDown' })
  expect(document.activeElement).toBe(last)
  fireEvent.keyDown(last, { key: 'ArrowDown' })
  expect(document.activeElement).toBe(finished)
  expect(onEnterWorkspaces).not.toHaveBeenCalled()

  fireEvent.keyDown(finished, { key: 'ArrowDown', repeat: true })
  expect(onEnterWorkspaces.mock.calls).toEqual([['first', true]])
})

it('hands the cursor back to the last workspace from its label', async () => {
  const onEnterWorkspaces = vi.fn(() => true)
  await renderList(onEnterWorkspaces)
  groupLabel().focus()

  fireEvent.keyDown(groupLabel(), { key: 'ArrowUp' })

  expect(onEnterWorkspaces.mock.calls).toEqual([['last', false]])
})

it('keeps the cursor on its last stop when no workspace takes it', async () => {
  await renderList(() => false)
  const finished = document.querySelector<HTMLElement>('[data-workspace-sessions-finished-toggle]')!
  finished.focus()

  fireEvent.keyDown(finished, { key: 'ArrowDown' })

  expect(document.activeElement).toBe(finished)
})

it('takes the cursor from the workspaces before it on its label, and from the top of the list on its last stop', async () => {
  await renderList()
  const workspaces = document.querySelector('[data-workspace-rows]')

  expect(offerSidebarSectionKeyboardCursor(workspaces, 'down', false)).toBe(true)
  expect(document.activeElement).toBe(groupLabel())

  expect(offerSidebarSectionKeyboardCursor(workspaces, 'up', false)).toBe(true)
  expect(document.activeElement).toBe(
    document.querySelector('[data-workspace-sessions-finished-toggle]')
  )
})

it('saves its fold with the other folds and keeps its label as the one stop while folded', async () => {
  await renderList()

  fireEvent.click(groupLabel())

  expect(saveUi.mock.calls).toEqual([[{ collapsedGroups: ['active-agents:unassigned'] }]])
  expect(sessionRows()).toEqual([])
  expect(groupLabel().getAttribute('aria-expanded')).toBe('false')
  expect(
    offerSidebarSectionKeyboardCursor(document.querySelector('[data-workspace-rows]'), 'up', false)
  ).toBe(true)
  expect(document.activeElement).toBe(groupLabel())
})

it('is absent while the filters leave none of its sessions', async () => {
  await renderList()

  act(() => sidebarSessionFilterStore.setStatus('attention'))

  expect(document.querySelector('[data-unassigned-sessions]')).toBeNull()
})

// Last: the marks store keeps the request, and a list mounted after it would show the row again.
it('unfolds the group and the ended sessions for a row asked for from elsewhere', async () => {
  useAppStore.setState({ collapsedGroups: new Set(['active-agents:unassigned']) })
  render(<SidebarList onEnterWorkspaces={() => true} />)
  await waitFor(() => expect(document.querySelector('[data-unassigned-sessions]')).not.toBeNull())
  expect(sessionRows()).toEqual([])

  act(() => liveSessionMarksStore.reveal('ended'))

  await waitFor(() =>
    expect(sessionRows().map((row) => row.dataset.liveSessionRow)).toEqual([
      'first',
      'last',
      'ended'
    ])
  )
})
