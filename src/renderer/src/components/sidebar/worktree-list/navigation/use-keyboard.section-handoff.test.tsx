// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { useRef } from 'react'
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

/** The sidebar's one list: an agents section, then the project rows this hook navigates. */
function SidebarList({
  activeWorktreeId,
  onEnterAgents
}: {
  activeWorktreeId: string
  onEnterAgents?: (edge: SidebarSectionEntryEdge) => boolean
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const { handleContainerKeyDown } = useWorktreeListKeyboardNavigation({
    rows: ROWS,
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
      <div data-worktree-sidebar-content {...SIDEBAR_KEYBOARD_SECTION_PROPS} />
    </div>
  )
}

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

  expect(onEnterAgents.mock.calls).toEqual([['last']])
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

it('takes the cursor from the section above on its first project row', () => {
  render(<SidebarList activeWorktreeId="bottom" onEnterAgents={() => true} />)

  expect(
    offerSidebarSectionKeyboardCursor(document.querySelector('[data-agent-rows]'), 'down')
  ).toBe(true)

  expect(activatedWorktreeIds()).toEqual(['top'])
  expect(document.activeElement).toBe(list())
})
