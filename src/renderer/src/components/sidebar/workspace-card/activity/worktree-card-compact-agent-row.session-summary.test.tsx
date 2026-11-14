// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { AgentStatusEntry } from '../../../../../../shared/agent-status/contracts/agent-status-types'
import type { LiveSession } from '../../../../../../shared/live-sessions/live-session-types'
import type { TerminalTab } from '../../../../../../shared/workspace-layout/terminal-tab-types'
import { buildWorktreeAgentRows } from './worktree-agent-rows'
import { CompactAgentRow } from './worktree-card-compact-agent-row'

vi.mock('@/components/dashboard/use-agent-row-conversation-name', () => ({
  useAgentRowConversationName: () => null
}))

vi.mock('./CacheTimer', () => ({
  default: () => null,
  usePromptCacheCountdownForPane: () => null
}))

const RAW_MESSAGE = 'I pushed the branch, opened PR #12 and added tests for the switch path.'
const PANE = 'tab-1:11111111-1111-4111-8111-111111111111'

function registrySession(overrides: Partial<LiveSession>): LiveSession {
  return {
    id: 'local:claude:conversation-1',
    provider: 'claude',
    providerSessionId: 'conversation-1',
    machine: { hostId: 'local', label: 'mbp', kind: 'local' },
    origin: 'seal',
    cwd: '/Users/brian/seal',
    project: 'seal',
    title: null,
    status: 'waiting-input',
    statusSource: 'seal-hooks',
    statusDetail: null,
    lastActivityAt: 1_000,
    startedAt: 1_000,
    alive: true,
    pid: 42,
    transcriptPath: null,
    inputRoutes: [],
    permission: null,
    ...overrides
  }
}

function stoppedAgent(providerSessionId?: string) {
  const tab: TerminalTab = {
    id: 'tab-1',
    ptyId: null,
    worktreeId: 'wt-1',
    title: 'Claude',
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 500
  }
  const entry: AgentStatusEntry = {
    paneKey: PANE,
    worktreeId: 'wt-1',
    tabId: tab.id,
    agentType: 'claude',
    state: 'done',
    prompt: 'add the account picker',
    lastAssistantMessage: RAW_MESSAGE,
    updatedAt: 1_000,
    stateStartedAt: 1_000,
    stateHistory: [],
    ...(providerSessionId ? { providerSession: { key: 'session_id', id: providerSessionId } } : {})
  }
  return buildWorktreeAgentRows({ tabs: [tab], entries: [entry], retained: [], now: 2_000 })[0]
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderRow(agent: ReturnType<typeof stoppedAgent>, sessions: LiveSession[]): void {
  vi.stubGlobal('api', {
    liveSessions: {
      onEvent: () => () => {},
      onMessage: () => () => {},
      snapshot: async () => ({ revision: 1, sessions, hostErrors: {} }),
      messages: async () => []
    }
  })
  render(
    <TooltipProvider>
      <CompactAgentRow agent={agent} now={2_000} onActivate={() => {}} />
    </TooltipProvider>
  )
}

it("shows the host's summary of a stopped pane in place of its raw last message", async () => {
  renderRow(stoppedAgent(), [
    registrySession({
      inputRoutes: [{ kind: 'seal-pane', paneKey: PANE }],
      summary: 'Opened PR #12 with the account picker.'
    })
  ])

  expect(await screen.findByText(/Opened PR #12 with the account picker\./)).toBeInTheDocument()
  expect(screen.queryByText(new RegExp(RAW_MESSAGE))).not.toBeInTheDocument()
  // The row is one truncated line, so its hover title carries the whole sentence.
  expect(
    screen.getByTitle('add the account picker - Opened PR #12 with the account picker.')
  ).toBeInTheDocument()
})

it('finds a paired server pane by the conversation it runs', async () => {
  renderRow(stoppedAgent('conversation-1'), [
    registrySession({ summary: 'Needs approval to deploy.' })
  ])

  expect(await screen.findByText(/Needs approval to deploy\./)).toBeInTheDocument()
})

it('keeps the raw last message while no summary exists', async () => {
  renderRow(stoppedAgent(), [registrySession({})])

  expect(await screen.findByText(new RegExp(RAW_MESSAGE))).toBeInTheDocument()
})
