// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { TooltipProvider } from '@/components/ui/tooltip'
import { sampleLiveSession } from '../live-sessions/live-session.test-fixture'
import LiveSessionWorkspace from '../live-sessions/workspace/LiveSessionWorkspace'
import { liveSessionTabsStore } from '../live-sessions/workspace/live-session-tabs-store'
import ItemSurfaceLayer from './ItemSurfaceLayer'
import { placeItemsInSplitView } from './split-view-commands'
import { useSplitViewShowing } from './split-view-showing'
import { splitViewStore } from './split-view-store'
import { EMPTY_SPLIT_VIEW } from './split-view-types'
import SplitViewLayer from './SplitViewLayer'

const SESSIONS = ['Fix the login bug', 'Refactor the parser', 'Write the release notes'].map(
  (title) => sampleLiveSession(title, { inputRoutes: [{ kind: 'seal-pane', paneKey: 'tab-1:0' }] })
)

/** The main area as the app shell composes it: the page or the grid, with the surfaces between. */
function MainArea(): React.JSX.Element {
  const showing = useSplitViewShowing()
  return (
    <TooltipProvider>
      {showing ? null : <LiveSessionWorkspace />}
      <ItemSurfaceLayer />
      {showing ? <SplitViewLayer /> : null}
    </TooltipProvider>
  )
}

function composer(): HTMLTextAreaElement {
  return screen.getByPlaceholderText<HTMLTextAreaElement>('Message this session')
}

function closePaneOf(title: string): void {
  const pane = screen.getByRole('group', { name: title })
  fireEvent.click(within(pane).getByRole('button', { name: 'Close pane' }))
}

const initialState = useAppStore.getInitialState()

beforeEach(() => {
  vi.stubGlobal('api', {
    liveSessions: {
      onEvent: () => () => {},
      onMessage: () => () => {},
      snapshot: async () => ({ revision: 1, sessions: SESSIONS, hostErrors: {} }),
      messages: async () => [],
      onTranscriptDelta: () => () => {},
      watchTranscript: async () => ({ watchId: 'watch-1', page: null }),
      unwatchTranscript: async () => {}
    }
  })
  useAppStore.setState(initialState, true)
})

afterEach(() => {
  cleanup()
  splitViewStore.update(() => EMPTY_SPLIT_VIEW)
  for (const id of liveSessionTabsStore.getState().tabs) {
    liveSessionTabsStore.close(id)
  }
  vi.unstubAllGlobals()
  useAppStore.setState(initialState, true)
})

it('keeps what was typed to a session when a neighbouring pane closes and when the grid ends', async () => {
  const [first, second, third] = SESSIONS
  liveSessionTabsStore.adopt([first.id])
  liveSessionTabsStore.activate(first.id)
  useAppStore.getState().openAgentSessionTabs()
  render(<MainArea />)
  const field = await waitFor(composer)
  fireEvent.change(field, { target: { value: 'unsent words' } })

  // Single view becomes a grid of three, the first session leftmost.
  act(() => {
    placeItemsInSplitView([{ kind: 'session', sessionId: second.id }], {
      paneId: null,
      zone: 'right'
    })
    placeItemsInSplitView([{ kind: 'session', sessionId: third.id }], {
      paneId: splitViewStore.getState().focusedPaneId,
      zone: 'right'
    })
  })
  expect(screen.getAllByRole('group').map((pane) => pane.getAttribute('aria-label'))).toEqual([
    'Fix the login bug',
    'Refactor the parser',
    'Write the release notes'
  ])
  const firstSurface = document.querySelector<HTMLElement>('[data-item-surface-pane-id]')!
  expect(within(firstSurface).getByPlaceholderText('Message this session')).toBe(field)

  // The tree changes shape, then the grid ends and the session page takes over.
  closePaneOf('Refactor the parser')
  expect(screen.getAllByRole('group')).toHaveLength(2)
  closePaneOf('Write the release notes')
  expect(screen.queryAllByRole('group')).toHaveLength(0)

  expect(composer()).toBe(field)
  expect(field.value).toBe('unsent words')
})

it('keeps what was typed to a session while another tab of the session page is in front', async () => {
  const [first, second] = SESSIONS
  liveSessionTabsStore.adopt([first.id, second.id])
  liveSessionTabsStore.activate(first.id)
  useAppStore.getState().openAgentSessionTabs()
  render(<MainArea />)
  const field = await waitFor(composer)
  fireEvent.change(field, { target: { value: 'unsent words' } })

  act(() => liveSessionTabsStore.activate(second.id))
  await waitFor(() =>
    expect(screen.getAllByPlaceholderText('Message this session')).toHaveLength(2)
  )
  act(() => liveSessionTabsStore.activate(first.id))

  expect(field.isConnected).toBe(true)
  expect(field.value).toBe('unsent words')
})
