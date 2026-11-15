// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
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
import { SAMPLE_NOW, sampleLiveSession } from '../live-session.test-fixture'
import ActiveAgentsSection from './ActiveAgentsSection'

const SESSIONS = [
  sampleLiveSession('first', { status: 'working', lastActivityAt: SAMPLE_NOW - 1_000 }),
  sampleLiveSession('last', { status: 'working', lastActivityAt: SAMPLE_NOW - 2_000 })
]

const saveUi = vi.fn(async () => {})
const initialState = useAppStore.getState()

function ProjectRows({
  onEnter
}: {
  onEnter: (edge: SidebarSectionEntryEdge) => boolean
}): React.JSX.Element {
  const rows = useRef<HTMLDivElement>(null)
  useSidebarSectionKeyboardEntry(() => rows.current, onEnter)
  return <div ref={rows} data-project-rows {...SIDEBAR_KEYBOARD_SECTION_PROPS} />
}

/** The sidebar's one list: Active agents, then the project rows, in one scroll container. */
function SidebarList({
  onEnterProjects
}: {
  onEnterProjects?: (edge: SidebarSectionEntryEdge) => boolean
}): React.JSX.Element {
  return (
    <TooltipProvider>
      <div data-worktree-sidebar>
        <ActiveAgentsSection />
        {onEnterProjects ? <ProjectRows onEnter={onEnterProjects} /> : null}
      </div>
    </TooltipProvider>
  )
}

function agentRows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-live-session-row]')]
}

async function renderList(
  onEnterProjects?: (edge: SidebarSectionEntryEdge) => boolean
): Promise<void> {
  render(<SidebarList onEnterProjects={onEnterProjects} />)
  await waitFor(() => expect(agentRows()).toHaveLength(2))
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
  useAppStore.setState(initialState, true)
})

it('moves the arrow-key cursor from its last agent into the section after it', async () => {
  const onEnterProjects = vi.fn(() => true)
  await renderList(onEnterProjects)
  const [first, last] = agentRows()
  first.focus()

  fireEvent.keyDown(first, { key: 'ArrowDown' })
  expect(document.activeElement).toBe(last)
  expect(onEnterProjects).not.toHaveBeenCalled()

  fireEvent.keyDown(last, { key: 'ArrowDown' })
  expect(onEnterProjects.mock.calls).toEqual([['first']])
})

it('keeps the cursor on its last agent when the section after it has no row to take it', async () => {
  await renderList(() => false)
  const last = agentRows()[1]
  last.focus()

  fireEvent.keyDown(last, { key: 'ArrowDown' })

  expect(document.activeElement).toBe(last)
})

it('takes the cursor back on its last agent from the section after it', async () => {
  await renderList(() => true)
  const projectRows = document.querySelector('[data-project-rows]')

  expect(offerSidebarSectionKeyboardCursor(projectRows, 'up')).toBe(true)

  expect(document.activeElement).toBe(agentRows()[1])
})

it('saves its fold with the project folds and leaves the cursor to Projects while folded', async () => {
  await renderList(() => true)

  fireEvent.click(document.querySelector('[data-active-agents-toggle] button')!)

  expect(saveUi.mock.calls).toEqual([[{ collapsedGroups: ['active-agents'] }]])
  expect(agentRows()).toEqual([])
  expect(
    offerSidebarSectionKeyboardCursor(document.querySelector('[data-project-rows]'), 'up')
  ).toBe(false)
})

it('opens folded when its fold was saved', async () => {
  useAppStore.setState({ collapsedGroups: new Set(['repo:seal', 'active-agents']) })
  render(<SidebarList />)

  const section = await waitFor(() => {
    const element = document.querySelector('[data-testid="active-agents"]')
    expect(element).not.toBeNull()
    return element!
  })
  expect(section.getAttribute('data-open')).toBe('false')
  expect(agentRows()).toEqual([])
})
