// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { TooltipProvider } from '@/components/ui/tooltip'
import { getLastSelectedMachineId } from '@/components/machines/model/machine-selection'

const navigation = vi.hoisted(() => ({
  reveal: vi.fn((): boolean => true),
  activate: vi.fn((): boolean => true)
}))
vi.mock('@/components/dashboard/navigation/reveal-dashboard-agent', () => ({
  revealDashboardAgent: navigation.reveal
}))
vi.mock('@/lib/workspace/activation/worktree-activation', () => ({
  activateAndRevealWorkspace: navigation.activate
}))

const { sealHomeOverviewProviders } = await import('./seal-home-overview-providers')
const { BUSY_HOME_PROVIDERS } = await import('./home-overview.test-fixture')
const { HomeOverview } = await import('./HomeOverviewPage')

const initialState = useAppStore.getState()

function renderHome(): void {
  render(
    <TooltipProvider>
      <HomeOverview
        providers={{ ...BUSY_HOME_PROVIDERS, Actions: sealHomeOverviewProviders.Actions }}
      />
    </TooltipProvider>
  )
}

function panel(title: string): HTMLElement {
  return screen.getByRole('heading', { name: title }).closest('section')!
}

beforeEach(() => {
  vi.stubGlobal('api', {})
  useAppStore.setState({ activeView: 'home', settingsNavigationTarget: null })
  navigation.reveal.mockClear().mockReturnValue(true)
  navigation.activate.mockClear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  useAppStore.setState(initialState, true)
})

it('every Home button navigates away or hands off to a real handler', () => {
  renderHome()
  const buttons = screen.getAllByRole('button')
  expect(buttons.length).toBeGreaterThan(15)
  for (const button of buttons) {
    useAppStore.setState({ activeView: 'home' })
    navigation.reveal.mockClear()
    navigation.activate.mockClear()
    fireEvent.click(button)
    const handled =
      useAppStore.getState().activeView !== 'home' ||
      navigation.reveal.mock.calls.length > 0 ||
      navigation.activate.mock.calls.length > 0
    expect(handled, button.textContent ?? '').toBe(true)
  }
})

it('Accounts Manage opens Settings on Accounts', () => {
  renderHome()
  fireEvent.click(within(panel('Accounts')).getByRole('button', { name: 'Manage' }))
  expect(useAppStore.getState().activeView).toBe('settings')
  expect(useAppStore.getState().settingsNavigationTarget).toMatchObject({ pane: 'accounts' })
})

it('a machine row opens the Machines page on that machine', () => {
  renderHome()
  fireEvent.click(within(panel('Machines')).getByText('gpu-box'))
  expect(useAppStore.getState().activeView).toBe('machines')
  expect(getLastSelectedMachineId()).toBe('machine:gpu')
})

it('an automation row opens that automation', () => {
  renderHome()
  fireEvent.click(within(panel('Automations')).getByText('Triage new issues'))
  expect(useAppStore.getState().activeView).toBe('automations')
  expect(useAppStore.getState().selectedAutomationId).toBe('2')
})

it('a PR row opens its worktree on its machine', () => {
  renderHome()
  fireEvent.click(within(panel('Worktrees & PRs')).getByText('seal/multi-account'))
  expect(navigation.activate).toHaveBeenCalledWith('b', { executionHostId: 'local' })
})

it('a session whose pane cannot be revealed opens as an agent session tab', () => {
  navigation.reveal.mockReturnValue(false)
  renderHome()
  fireEvent.click(within(panel('Sessions')).getByText('Nightly eval'))
  expect(useAppStore.getState().activeView).toBe('sessions')
})
