// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { useContext } from 'react'
import { act, cleanup, render, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type {
  ProviderRateLimits,
  RateLimitState
} from '../../../../shared/agent-usage/rate-limits/rate-limit-types'
import { createEmptyRateLimitState } from '../../../../shared/agent-usage/rate-limits/rate-limit-state-factory'
import type { RuntimeClientTarget } from '../../../../shared/remote-runtime/host-catalog/runtime-client-target'
import type { SealAccountsStatus } from '../../../../shared/seal-accounts/seal-accounts-status'
import { TooltipProvider } from '@/components/ui/tooltip'
import type * as SealHostStore from './seal-session-status-store'

const rpc = vi.hoisted(() => ({
  call: vi.fn<(target: unknown, method: string, params?: unknown) => Promise<unknown>>()
}))
vi.mock('@/runtime/rpc/calls/runtime-rpc-call', () => ({ callRuntimeRpc: rpc.call }))

const NOW = Date.UTC(2026, 10, 14, 9, 0)
const LOCAL: RuntimeClientTarget = { kind: 'local' }
const SERVER: RuntimeClientTarget = { kind: 'environment', environmentId: 'env-1' }
const WORK = 'claude:work@acme.dev#Acme'
const PERSONAL = 'claude:brian@example.com'

function reading(
  session: number,
  weekly: number,
  patch: Partial<ProviderRateLimits> = {}
): ProviderRateLimits {
  return {
    provider: 'claude',
    session: { usedPercent: session, windowMinutes: 300, resetsAt: null, resetDescription: null },
    weekly: { usedPercent: weekly, windowMinutes: 10_080, resetsAt: null, resetDescription: null },
    updatedAt: NOW,
    error: null,
    status: 'ok',
    ...patch
  }
}

/** What the usage popover reads: Work selected at 37/64, the machine's own login at 71/12. */
function popoverUsage(patch: Partial<RateLimitState> = {}): RateLimitState {
  return {
    ...createEmptyRateLimitState(),
    claude: reading(37, 64),
    systemLoginUsage: {
      claude: { identity: PERSONAL, rateLimits: reading(71, 12), isFetching: false }
    },
    ...patch
  }
}

async function setUp(): Promise<{
  hostStatus: SealAccountsStatus
  store: typeof SealHostStore
  pushUsage: (rateLimits: RateLimitState) => void
}> {
  vi.resetModules()
  const { useAppStore } = await import('@/store')
  const { populatedScenario } =
    await import('../settings/seal-accounts/seal-accounts-page.test-fixture')
  // The host answers with older figures of its own: Work 82/41 and Personal 18/22.
  const hostStatus = populatedScenario().status
  rpc.call.mockImplementation(async (_target, method) =>
    method === 'seal.accounts.status' ? hostStatus : null
  )
  useAppStore.setState({ rateLimits: popoverUsage() })
  return {
    hostStatus,
    store: await import('./seal-session-status-store'),
    pushUsage: (rateLimits) => act(() => useAppStore.setState({ rateLimits }))
  }
}

function usageOf(status: SealAccountsStatus, key: string): [number, number] | null {
  const limits = status.providers.claude.candidates.find((c) => c.key === key)?.limits
  return limits?.session && limits.weekly
    ? [limits.session.usedPercent, limits.weekly.usedPercent]
    : null
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.stubGlobal('api', {})
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  rpc.call.mockReset()
})

it('shows this device’s accounts with the usage popover’s readings, not the host answer’s', async () => {
  const { store, pushUsage } = await setUp()
  const stop = store.subscribeSealHost(LOCAL, () => {})
  await waitFor(() => expect(store.sealHostSnapshot(LOCAL)).not.toBeNull())

  const shown = (): SealAccountsStatus => store.sealHostSnapshot(LOCAL)!.status
  expect(usageOf(shown(), WORK)).toEqual([37, 64])
  expect(usageOf(shown(), PERSONAL)).toEqual([71, 12])

  // A new reading shows at once, before the host is asked again.
  const asked = rpc.call.mock.calls.length
  pushUsage(popoverUsage({ claude: reading(40, 65) }))
  expect(usageOf(shown(), WORK)).toEqual([40, 65])
  expect(rpc.call.mock.calls).toHaveLength(asked)
  stop()
})

it('keeps another host’s own readings', async () => {
  const { store } = await setUp()
  const stop = store.subscribeSealHost(SERVER, () => {})
  await waitFor(() => expect(store.sealHostSnapshot(SERVER)).not.toBeNull())
  expect(usageOf(store.sealHostSnapshot(SERVER)!.status, WORK)).toEqual([82, 41])
  stop()
})

it('asks the host for fresh usage once when two views open together', async () => {
  const { store } = await setUp()
  await Promise.all([
    store.refreshSealHost(LOCAL, 'on-open'),
    store.refreshSealHost(LOCAL, 'on-open')
  ])
  const refreshes = rpc.call.mock.calls.filter(
    ([, method, params]) =>
      method === 'seal.accounts.status' && JSON.stringify(params) === '{"refreshUsage":true}'
  )
  expect(refreshes).toHaveLength(1)
})

async function renderHomeAccounts(): Promise<HTMLElement> {
  const { sealHomeOverviewProviders } =
    await import('../home-overview/seal-home-overview-providers')
  const { HomeAccountsContext } = await import('../home-overview/home-overview-contexts')
  const { HomeAccountsPanel } = await import('../home-overview/HomeAccountsPanel')
  const Panel = (): React.JSX.Element => (
    <HomeAccountsPanel accounts={useContext(HomeAccountsContext)} onManage={() => {}} />
  )
  const view = render(
    <sealHomeOverviewProviders.Accounts>
      <Panel />
    </sealHomeOverviewProviders.Accounts>
  )
  await view.findByText('Work Max')
  return view.container
}

async function renderManageAccounts(): Promise<HTMLElement> {
  const { SealAccountsPage } = await import('../settings/seal-accounts/SealAccountsPage')
  const view = render(
    <TooltipProvider>
      <SealAccountsPage target={LOCAL} />
    </TooltipProvider>
  )
  await view.findAllByText('Work Max')
  return view.container
}

function usageText(root: HTMLElement, account: string): string {
  const row = within(root)
    .getAllByText(account)
    .map((label) => label.closest('li, [data-slot="seal-account-card"]'))
    .find((candidate) => candidate?.querySelector('[data-slot="account-usage-reading"]'))
  return row?.querySelector('[data-slot="account-usage-reading"]')?.textContent ?? ''
}

it('Home and Manage accounts draw every account from the usage popover’s readings', async () => {
  await setUp()
  const home = await renderHomeAccounts()
  const manage = await renderManageAccounts()

  for (const view of [home, manage]) {
    expect(usageText(view, 'Work Max')).toContain('37%')
    expect(usageText(view, 'Work Max')).toContain('64%')
    expect(usageText(view, 'Personal')).toContain('71%')
    expect(usageText(view, 'Personal')).toContain('12%')
  }
})

it('a throttled check leaves the last good figures and their age in both views', async () => {
  const { pushUsage } = await setUp()
  pushUsage(
    popoverUsage({
      claude: reading(37, 64, {
        status: 'error',
        error: 'Claude usage is rate limited right now.',
        updatedAt: NOW - 12 * 60_000,
        usageMetadata: { failureKind: 'rate-limited' }
      })
    })
  )
  const home = await renderHomeAccounts()
  const manage = await renderManageAccounts()

  for (const view of [home, manage]) {
    const text = usageText(view, 'Work Max')
    expect(text).toContain('37%')
    expect(text).toContain('Updated 12m ago')
    expect(text).not.toContain('throttled')
  }
})
