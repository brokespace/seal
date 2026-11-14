// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { LiveSession } from '../../../../shared/live-sessions/live-session-types'
import type { MachineSummary } from '../../../../shared/machines/machine-summaries'
import { HomeAttentionStrip } from '../home-overview/HomeAttentionStrip'
import { HomeSessionsPanel } from '../home-overview/HomeSessionsPanel'
import { sealHomeOverviewActions } from '../home-overview/home-overview-actions'
import { MachineSessionList } from '../machines/detail/MachineSessionList'
import { activeLiveSessionsByMachine } from '../machines/model/machine-live-sessions'
import ActiveAgentsSection from './active-agents/ActiveAgentsSection'
import { buildActiveAgents } from './active-agents/active-agents-model'
import { liveSessionBadges, type LiveSessionLink } from './links/live-session-links'
import { liveSessionRegistryStore, useLiveSessions } from './live-session-registry-store'
import { SAMPLE_NOW, sampleLiveSession } from './live-session-sample'
import { liveSessionDialogStore } from './menu/live-session-dialog-store'
import { liveSessionTabsStore } from './workspace/live-session-tabs-store'

const GPU_BOX = {
  hostId: 'ssh-gpu',
  label: 'gpu-box',
  kind: 'remote',
  machineId: 'machine:gpu'
} as const

const GPU_MACHINE: MachineSummary = {
  id: 'machine:gpu',
  connection: 'ssh',
  label: 'gpu-box',
  address: 'brian@gpu-box:22',
  status: 'online',
  statusDetail: null,
  os: 'linux',
  sshTargetId: 'ssh-gpu',
  runtimeEnvironmentId: null,
  executionHostId: 'ssh:ssh-gpu'
}

const ASKS = sampleLiveSession('asks', {
  title: 'Fix the coupon bug',
  machine: GPU_BOX,
  origin: 'seal',
  status: 'needs-permission',
  statusDetail: 'Allow Bash?',
  inputRoutes: [{ kind: 'seal-pane', paneKey: 'tab-1:0' }]
})
const SESSIONS: LiveSession[] = [
  ASKS,
  sampleLiveSession('external', { machine: GPU_BOX, status: 'working' }),
  sampleLiveSession('local-idle')
]

const SURFACES = ['active-agents', 'home', 'home-attention', 'machines'] as const

function Surfaces(): React.JSX.Element {
  const { sessions } = useLiveSessions()
  return (
    <TooltipProvider>
      <div data-surface="active-agents">
        <ActiveAgentsSection />
      </div>
      <div data-surface="home">
        <HomeSessionsPanel sessions={sessions} now={SAMPLE_NOW} />
      </div>
      <div data-surface="home-attention">
        <HomeAttentionStrip
          sessions={sessions.filter((session) => session.id === ASKS.id)}
          onOpen={sealHomeOverviewActions.openSession}
        />
      </div>
      <div data-surface="machines">
        <MachineSessionList
          sessions={activeLiveSessionsByMachine([GPU_MACHINE], sessions).get(GPU_MACHINE.id) ?? []}
        />
      </div>
    </TooltipProvider>
  )
}

function surface(name: (typeof SURFACES)[number]): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-surface="${name}"]`)!
}

function row(name: (typeof SURFACES)[number], sessionId = ASKS.id): HTMLElement {
  return surface(name).querySelector<HTMLElement>(`[data-live-session-row="${sessionId}"]`)!
}

async function renderSurfaces(): Promise<void> {
  render(<Surfaces />)
  await waitFor(() => expect(row('active-agents')).not.toBeNull())
}

const initialState = useAppStore.getState()

beforeEach(() => {
  vi.useFakeTimers({ now: SAMPLE_NOW, toFake: ['Date'] })
  vi.stubGlobal('api', {
    liveSessions: {
      onEvent: () => () => {},
      onMessage: () => () => {},
      snapshot: async () => ({ revision: 1, sessions: SESSIONS, hostErrors: {} }),
      messages: async () => []
    }
  })
  useAppStore.setState({ activeView: 'home' })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  liveSessionDialogStore.show(null)
  for (const id of liveSessionTabsStore.getState().tabs) {
    liveSessionTabsStore.close(id)
  }
  useAppStore.setState(initialState, true)
})

describe('one session on every surface', () => {
  it('is the same row in Active agents, on Home and on its machine', async () => {
    await renderSurfaces()
    const rows = (['active-agents', 'home', 'machines'] as const).map((name) => row(name))
    for (const element of rows) {
      expect(element.getAttribute('data-status')).toBe('needs-permission')
      expect(element.getAttribute('data-status-group')).toBe('attention')
      expect(
        element
          .querySelector('[data-live-session-status]')
          ?.getAttribute('data-live-session-status')
      ).toBe('needs-permission')
      expect(element.textContent).toContain('Fix the coupon bug')
    }
    expect(new Set(rows.map((element) => element.textContent)).size).toBe(1)
    expect(
      surface('home-attention')
        .querySelector('[data-live-session-status]')
        ?.getAttribute('data-live-session-status')
    ).toBe('needs-permission')
  })

  it('lists a machine with the sessions Active agents lists under it, in the same order', async () => {
    await renderSurfaces()
    const ids = (name: (typeof SURFACES)[number]): string[] =>
      [...surface(name).querySelectorAll('[data-live-session-row]')].map((element) =>
        element.getAttribute('data-live-session-row')!
      )
    expect(ids('machines')).toEqual(['asks', 'external'])
    expect(ids('home')).toEqual(['local-idle', 'asks', 'external'])
    expect(ids('active-agents')).toEqual(['local-idle', 'asks', 'external'])
  })

  it.each(['active-agents', 'home', 'machines'] as const)(
    'opens as the same session tab from its %s row',
    async (name) => {
      await renderSurfaces()
      fireEvent.click(row(name))
      expect(liveSessionTabsStore.getState()).toMatchObject({ activeId: 'asks', previewId: 'asks' })
      expect(useAppStore.getState().activeView).toBe('sessions')
    }
  )

  it('opens as the same session tab from the Home attention strip', async () => {
    await renderSurfaces()
    fireEvent.click(surface('home-attention').querySelector('[data-home-attention="asks"]')!)
    expect(liveSessionTabsStore.getState()).toMatchObject({ activeId: 'asks', previewId: 'asks' })
    expect(useAppStore.getState().activeView).toBe('sessions')
  })

  it.each(['active-agents', 'home', 'machines'] as const)(
    'asks before stopping it through the one session dialog from its %s menu',
    async (name) => {
      await renderSurfaces()
      const trigger = row(name).querySelector<HTMLElement>('[data-live-session-actions]')!
      fireEvent.keyDown(trigger, { key: 'Enter' })
      const items = [...document.querySelectorAll('[data-live-session-menu-item]')].map((item) =>
        item.getAttribute('data-live-session-menu-item')
      )
      expect(items).toContain('open-worktree')
      expect(items).toContain('delete-with-transcripts')
      fireEvent.click(document.querySelector('[data-live-session-menu-item="stop"]')!)
      expect(liveSessionDialogStore.getState()).toEqual({
        kind: 'danger',
        danger: 'stop',
        sessions: [liveSessionRegistryStore.getState().sessions.find((s) => s.id === 'asks')]
      })
    }
  )
})

describe('a workspace badge', () => {
  it('counts the sessions Active agents lists for that workspace', () => {
    const links = new Map<string, LiveSessionLink>([
      ['asks', { worktreeId: 'wt-shop', repoId: 'repo-1', name: 'shop' }],
      ['external', { worktreeId: 'wt-shop', repoId: 'repo-1', name: 'shop' }],
      ['local-idle', { worktreeId: 'wt-docs', repoId: 'repo-1', name: 'docs' }]
    ])
    const badge = liveSessionBadges(SESSIONS, links).byWorktree.get('wt-shop')
    const listed = buildActiveAgents(
      SESSIONS,
      { query: '', chips: new Set(), scope: { kind: 'worktree', id: 'wt-shop', label: 'shop' } },
      links,
      SAMPLE_NOW
    ).machines.flatMap((machine) => machine.sessions.map((session) => session.id))
    expect(badge).toEqual({
      count: 2,
      status: 'needs-permission',
      sessionIds: ['asks', 'external']
    })
    expect(listed).toEqual(['asks', 'external'])
  })
})
