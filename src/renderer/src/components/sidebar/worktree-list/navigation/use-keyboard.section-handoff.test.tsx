// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { memo, useRef } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import type { HostSectionRow } from '../../../../../../shared/sidebar-list/hosts/host-section-rows'
import {
  offerSidebarSectionKeyboardCursor,
  SIDEBAR_KEYBOARD_SECTION_PROPS,
  useSidebarSectionKeyboardEntry,
  type SidebarSectionEntryEdge
} from '../../sidebar-section-keyboard-handoff'
import { repo, worktree } from '../grouping/worktree-list-groups-test-fixtures'
import { useWorktreeListKeyboardNavigation } from './use-keyboard'

const activate = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@/lib/workspace/activation/sidebar-worktree-activation', () => ({
  activateWorktreeFromSidebar: activate
}))
vi.mock('./use-neighbor-prewarm', () => ({ useWorkspaceNeighborPrewarm: () => {} }))

function row(id: string): HostSectionRow {
  return {
    type: 'item',
    rowKey: `row:${id}`,
    sectionKey: `repo:${repo.id}`,
    worktree: { ...worktree, id },
    repo,
    depth: 0,
    groupDepth: 0,
    isLastLineageChild: false,
    lineageChildCount: 0
  }
}

const ROWS = [row('top'), row('middle'), row('bottom')]

function AgentRows({
  onEnter
}: {
  onEnter: (edge: SidebarSectionEntryEdge) => boolean
}): React.JSX.Element {
  const rows = useRef<HTMLDivElement>(null)
  useSidebarSectionKeyboardEntry(() => rows.current, onEnter)
  return <div ref={rows} data-agent-rows {...SIDEBAR_KEYBOARD_SECTION_PROPS} />
}

/** The sidebar's one list: an agents section, then the project rows this hook navigates. Memoized like the real viewport. */
const SidebarList = memo(function SidebarList({
  activeWorktreeId,
  onEnterAgents,
  projectRowsMounted = true,
  rows = ROWS
}: {
  activeWorktreeId: string
  onEnterAgents?: (edge: SidebarSectionEntryEdge) => boolean
  projectRowsMounted?: boolean
  rows?: HostSectionRow[]
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const { handleContainerKeyDown } = useWorktreeListKeyboardNavigation({
    rows,
    activeWorktreeId,
    activeWorkspaceExecutionHostId: null,
    pinnedDisplayPolicy: 'single-location',
    scrollRef,
    activeModal: 'none',
    markDirectScrollInput: () => {}
  })
  return (
    <div ref={scrollRef} data-worktree-sidebar tabIndex={0} onKeyDown={handleContainerKeyDown}>
      {onEnterAgents ? <AgentRows onEnter={onEnterAgents} /> : null}
      {projectRowsMounted ? (
        <div data-worktree-sidebar-content {...SIDEBAR_KEYBOARD_SECTION_PROPS} />
      ) : null}
    </div>
  )
})

function list(): HTMLElement {
  return document.querySelector<HTMLElement>('[data-worktree-sidebar]')!
}

function activatedWorktreeIds(): unknown[] {
  return activate.mock.calls.map((call: unknown[]) => call[0])
}

const initialState = useAppStore.getState()

beforeEach(() => {
  activate.mockClear()
})

afterEach(() => {
  cleanup()
  useAppStore.setState(initialState, true)
})

it('hands the cursor to the section above instead of wrapping from the first project row', () => {
  const onEnterAgents = vi.fn(() => true)
  render(<SidebarList activeWorktreeId="top" onEnterAgents={onEnterAgents} />)

  fireEvent.keyDown(list(), { key: 'ArrowUp' })

  expect(onEnterAgents.mock.calls).toEqual([['last', false]])
  expect(activatedWorktreeIds()).toEqual([])
})

it('wraps from the last project row to the top of the list, the first row of the section above', () => {
  const onEnterAgents = vi.fn(() => true)
  render(<SidebarList activeWorktreeId="bottom" onEnterAgents={onEnterAgents} />)

  fireEvent.keyDown(list(), { key: 'ArrowDown' })

  expect(onEnterAgents.mock.calls).toEqual([['first', false]])
  expect(activatedWorktreeIds()).toEqual([])
})

it('wraps to the last project row when the section above has no row to take the cursor', () => {
  render(<SidebarList activeWorktreeId="top" onEnterAgents={() => false} />)

  fireEvent.keyDown(list(), { key: 'ArrowUp' })

  expect(activatedWorktreeIds()).toEqual(['bottom'])
})

it('moves between project rows without involving the section above', () => {
  const onEnterAgents = vi.fn(() => true)
  render(<SidebarList activeWorktreeId="middle" onEnterAgents={onEnterAgents} />)

  fireEvent.keyDown(list(), { key: 'ArrowUp' })

  expect(onEnterAgents).not.toHaveBeenCalled()
  expect(activatedWorktreeIds()).toEqual(['top'])
})

it('switches to no project row when a held key carries the cursor into the section above', () => {
  vi.useFakeTimers()
  try {
    useAppStore.setState({ activeWorktreeId: 'middle' })
    render(<SidebarList activeWorktreeId="middle" onEnterAgents={() => true} />)

    fireEvent.keyDown(list(), { key: 'ArrowUp', repeat: true })
    fireEvent.keyDown(list(), { key: 'ArrowUp', repeat: true })
    vi.advanceTimersByTime(1000)
    fireEvent.keyUp(window, { key: 'ArrowUp' })

    expect(activatedWorktreeIds()).toEqual([])
  } finally {
    vi.useRealTimers()
  }
})

it('stops scrolling to the project row it left when the cursor moves on to the section above', () => {
  render(<SidebarList activeWorktreeId="middle" onEnterAgents={() => true} />)

  fireEvent.keyDown(list(), { key: 'ArrowUp', repeat: true })
  expect(useAppStore.getState().pendingRevealWorktree?.worktreeId).toBe('top')
  fireEvent.keyDown(list(), { key: 'ArrowUp', repeat: true })

  expect(useAppStore.getState().pendingRevealWorktree).toBeNull()
})

it('takes the cursor from the section above on its first project row', () => {
  render(<SidebarList activeWorktreeId="bottom" onEnterAgents={() => true} />)

  expect(
    offerSidebarSectionKeyboardCursor(document.querySelector('[data-agent-rows]'), 'down', false)
  ).toBe(true)

  expect(activatedWorktreeIds()).toEqual(['top'])
  expect(document.activeElement).toBe(list())
})

it('previews the first project row, and switches where the key stops, when a held key brings the cursor in', () => {
  vi.useFakeTimers()
  try {
    useAppStore.setState({ activeWorktreeId: 'bottom' })
    render(<SidebarList activeWorktreeId="bottom" onEnterAgents={() => true} />)

    offerSidebarSectionKeyboardCursor(document.querySelector('[data-agent-rows]'), 'down', true)
    fireEvent.keyDown(list(), { key: 'ArrowDown', repeat: true })
    expect(activatedWorktreeIds()).toEqual([])
    vi.advanceTimersByTime(1000)

    expect(activatedWorktreeIds()).toEqual(['middle'])
  } finally {
    vi.useRealTimers()
  }
})

it('takes the cursor on project rows that mounted after the list did', () => {
  const view = render(
    <SidebarList activeWorktreeId="bottom" onEnterAgents={() => true} projectRowsMounted={false} />
  )
  view.rerender(<SidebarList activeWorktreeId="bottom" onEnterAgents={() => true} />)

  expect(
    offerSidebarSectionKeyboardCursor(document.querySelector('[data-agent-rows]'), 'down', false)
  ).toBe(true)

  expect(activatedWorktreeIds()).toEqual(['top'])
})

it('takes the cursor on the rows of the latest render', () => {
  const onEnterAgents = (): boolean => true
  const view = render(
    <SidebarList activeWorktreeId="middle" onEnterAgents={onEnterAgents} rows={[ROWS[2]]} />
  )
  view.rerender(<SidebarList activeWorktreeId="middle" onEnterAgents={onEnterAgents} />)

  expect(
    offerSidebarSectionKeyboardCursor(document.querySelector('[data-agent-rows]'), 'down', false)
  ).toBe(true)

  expect(activatedWorktreeIds()).toEqual(['top'])
})
