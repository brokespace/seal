// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { TooltipProvider } from '@/components/ui/tooltip'
import { liveSessionMarksStore } from '@/components/live-sessions/live-session-marks-store'
import { SAMPLE_NOW, sampleLiveSession } from '../live-sessions/live-session.test-fixture'
import { makeRepo } from '../worktree-jump/worktree-jump-palette-test-fixtures'
import { ProjectAgentsCard } from './ProjectAgentsCard'
import { ProjectOverviewHeaderActions } from './ProjectOverviewHeaderActions'
import ProjectOverviewPage from './ProjectOverviewPage'

const openAgentSession = vi.hoisted(() => vi.fn())
vi.mock('@/components/live-sessions/open/open-agent-session', () => ({ openAgentSession }))

const repo = makeRepo()
const GPU = { hostId: 'ssh-gpu', label: 'gpu-box', kind: 'remote' } as const
const sessions = [
  sampleLiveSession('Fix the login bug', { status: 'working' }),
  sampleLiveSession('Pick a dataset', { status: 'waiting-input', machine: GPU }),
  sampleLiveSession('Bump the lockfile', {
    status: 'done',
    alive: false,
    lastActivityAt: SAMPLE_NOW - 3_600_000
  })
]

function renderInApp(ui: React.ReactElement): void {
  render(<TooltipProvider>{ui}</TooltipProvider>)
}

const initial = useAppStore.getInitialState()
beforeEach(() => {
  vi.stubGlobal('api', {})
  openAgentSession.mockClear()
  useAppStore.setState(initial, true)
  useAppStore.setState({ repos: [repo], activeView: 'project' })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  useAppStore.setState(initial, true)
})

it("lists the project's running agents under their machine and the ended ones apart", () => {
  renderInApp(<ProjectAgentsCard sessions={sessions} now={SAMPLE_NOW} />)
  const groups = [...document.querySelectorAll<HTMLElement>('[data-sessions-machine]')]
  expect(
    groups.map((group) => [
      group.dataset.sessionsMachine,
      [...group.querySelectorAll('[data-live-session-row]')].map((row) =>
        row.getAttribute('data-live-session-row')
      )
    ])
  ).toEqual([
    ['local', ['Fix the login bug']],
    ['ssh-gpu', ['Pick a dataset']]
  ])
  const finished = document.querySelector<HTMLElement>('[data-project-overview-finished]')!
  expect(
    [...finished.querySelectorAll('[data-live-session-row]')].map((row) =>
      row.getAttribute('data-live-session-row')
    )
  ).toEqual(['Bump the lockfile'])
})

it('an agent opens as its session', () => {
  renderInApp(<ProjectAgentsCard sessions={sessions} now={SAMPLE_NOW} />)
  fireEvent.click(screen.getByText('Pick a dataset'))
  expect(openAgentSession).toHaveBeenCalledWith('Pick a dataset', 'preview')
})

it("Show in Active agents asks the sidebar for the project's first running agent and stays on the page", () => {
  renderInApp(<ProjectAgentsCard sessions={sessions} now={SAMPLE_NOW} />)
  fireEvent.click(screen.getByRole('button', { name: 'Show in Active agents' }))
  expect(useAppStore.getState().activeView).toBe('project')
  expect(liveSessionMarksStore.getState().reveal?.sessionId).toBe('Fix the login bug')
})

it('New agent opens the composer on this project and its machine', () => {
  renderInApp(<ProjectOverviewHeaderActions repo={repo} machine={null} mainWorktree={null} />)
  fireEvent.click(screen.getByRole('button', { name: 'New agent' }))
  const { activeModal, modalData } = useAppStore.getState()
  expect(activeModal).toBe('new-workspace-composer')
  expect(modalData).toMatchObject({ agentSession: true, initialRepoId: 'repo-1' })
})

it('a project that is no longer in the app shows the way back instead of an empty page', () => {
  useAppStore.setState({ activeView: 'tasks' })
  useAppStore.getState().openProjectOverview({ ...repo, id: 'removed' })
  renderInApp(<ProjectOverviewPage />)
  const missing = document.querySelector<HTMLElement>('[data-project-overview-missing]')!
  fireEvent.click(within(missing).getByRole('button', { name: 'Go back' }))
  expect(useAppStore.getState().activeView).toBe('tasks')
})
