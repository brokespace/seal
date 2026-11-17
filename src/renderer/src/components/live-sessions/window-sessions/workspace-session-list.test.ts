import { describe, expect, it } from 'vitest'
import type { DashboardAgentRow } from '@/components/dashboard/rows/dashboard-agent-row'
import type { StructuredTab } from '@/components/native-chat/session/status/structured-agent-session-tabs'
import type { AgentStatusEntry } from '../../../../../shared/agent-status/contracts/agent-status-types'
import { sampleSessionSurface } from '../../../../../shared/live-sessions/live-session-surface.test-fixture'
import type {
  LiveSession,
  LiveSessionMachine
} from '../../../../../shared/live-sessions/live-session-types'
import { sampleLiveSession } from '../live-session.test-fixture'
import { windowAgentSession } from './window-agent-session'
import { workspaceSessionList } from './workspace-session-list'

const NOW = 1_000_000
const SERVER: LiveSessionMachine = {
  hostId: 'server-7',
  label: 'kessel-ar-dev',
  kind: 'remote',
  executionHostId: 'runtime:env-7',
  connection: 'server'
}
const CHAT: StructuredTab = {
  id: 'tab-chat',
  entityId: 'chat-1',
  groupId: 'group-1',
  worktreeId: 'wt-dev',
  contentType: 'agent-session',
  label: 'Claude',
  customLabel: null,
  color: null,
  sortOrder: 0,
  createdAt: 0
}
const CHAT_PANE = 'tab-chat:leaf'

function agentRow(
  paneKey: string,
  entry: Partial<AgentStatusEntry>,
  patch: Partial<DashboardAgentRow> = {}
): DashboardAgentRow {
  return {
    paneKey,
    agentType: 'claude',
    state: 'working',
    rowSource: 'live',
    startedAt: NOW - 60_000,
    tab: {
      id: paneKey.slice(0, paneKey.lastIndexOf(':')),
      worktreeId: 'wt-dev',
      ptyId: null,
      title: 'Agent',
      customTitle: null,
      color: null,
      sortOrder: 0,
      createdAt: 0
    },
    entry: {
      paneKey,
      state: 'working',
      prompt: 'Claude identity question',
      updatedAt: NOW - 1000,
      stateStartedAt: NOW - 60_000,
      stateHistory: [],
      ...entry
    },
    ...patch
  }
}

function record(patch: Partial<LiveSession>): LiveSession {
  return sampleLiveSession('server-7:claude:5f0c', {
    providerSessionId: '5f0c',
    machine: SERVER,
    origin: 'seal',
    ...sampleSessionSurface('external'),
    title: 'Claude identity question',
    status: 'your-turn',
    statusSource: 'seal-hooks',
    inputRoutes: [{ kind: 'structured', sessionId: 'chat-1' }],
    ...patch
  })
}

function list(
  rows: DashboardAgentRow[],
  all: LiveSession[],
  listed: readonly LiveSession[] = all
): readonly LiveSession[] {
  const chats = new Map([[CHAT_PANE, CHAT]])
  return workspaceSessionList({
    listed,
    all,
    rows,
    chats,
    build: (row, chat, subagents) =>
      windowAgentSession(
        row,
        { worktreeId: 'wt-dev', machine: SERVER, chat, name: null, cwd: '/srv/dev', subagents },
        NOW
      )
  })
}

describe('a workspace card lists each agent session once', () => {
  it('leaves a chat to the record its server lists', () => {
    const listed = [record({ surface: { kind: 'chat', sessionId: 'chat-1', tabId: 'tab-far' } })]
    expect(list([agentRow(CHAT_PANE, { state: 'done' })], listed)).toBe(listed)
  })

  it('lists a chat from this window until its server lists it', () => {
    const [session, ...rest] = list(
      [agentRow(CHAT_PANE, { state: 'done', model: 'claude-fable-5' })],
      []
    )
    expect(rest).toEqual([])
    expect(session).toMatchObject({
      id: 'server-7:claude:seal-chat-1',
      provider: 'claude',
      title: 'Claude identity question',
      status: 'your-turn',
      alive: true,
      model: 'claude-fable-5',
      machine: { label: 'kessel-ar-dev', connection: 'server' },
      surface: { kind: 'chat', sessionId: 'chat-1', tabId: 'tab-chat' }
    })
  })

  it.each<[string, Partial<LiveSession>, Partial<AgentStatusEntry>]>([
    ['its pane', { surface: { kind: 'cli', paneKey: 'tab-1:0' } }, {}],
    [
      'the session its hooks named',
      { surface: { kind: 'external' } },
      { providerSession: { key: 'session_id', id: '5f0c' } }
    ],
    [
      'its process, before its hooks name the session',
      { surface: { kind: 'external' }, providerSessionId: 'pid-4100' },
      {}
    ]
  ])('leaves a terminal agent to the record found by %s', (_, patch, entry) => {
    const listed = [record(patch)]
    expect(list([agentRow('tab-1:0', entry)], listed)).toBe(listed)
  })

  it('lists an agent known only by its pane title', () => {
    const sessions = list(
      [
        agentRow(
          'tab-2:0',
          { agentType: 'aider', prompt: 'aider', lastAssistantMessage: 'Running' },
          { agentType: 'aider', startedAt: 0 }
        )
      ],
      []
    )
    expect(
      sessions.map((s) => [s.id, s.provider, s.status, s.surface, s.capabilities.send])
    ).toEqual([
      [
        'server-7:aider:pane-tab-2:0',
        'aider',
        'working',
        { kind: 'cli', paneKey: 'tab-2:0' },
        false
      ]
    ])
  })

  it('counts the subagents this window sees under their agent', () => {
    const child = agentRow(
      'tab-1:0:child-1',
      {},
      {
        rowSource: 'subagent',
        activationPaneKey: 'tab-1:0',
        childRow: {
          kind: 'agent',
          id: 'child-1',
          name: 'Audit payments',
          displayState: 'working',
          detail: null,
          settled: false,
          canStop: false,
          firstObservedAt: NOW - 5000,
          recencyAt: NOW - 5000,
          owned: []
        }
      }
    )
    const counted = [[['Audit payments', 'running']]]
    const subagents = (sessions: readonly LiveSession[]): unknown =>
      sessions.map((s) => s.activity?.subagents.map((a) => [a.title, a.status]))
    expect(subagents(list([agentRow('tab-1:0', {}), child], []))).toEqual(counted)
    // Also on a record whose host reports none.
    const listed = [record({ surface: { kind: 'cli', paneKey: 'tab-1:0' } })]
    expect(subagents(list([agentRow('tab-1:0', {}), child], listed))).toEqual(counted)
  })

  it("leaves a paired host's terminal agent to the record that names its pane as that host does", () => {
    const leaf = '1515e460-427e-4df1-af28-daca0675b0ad'
    const listed = [record({ surface: { kind: 'cli', paneKey: `tab-9:${leaf}` } })]
    expect(list([agentRow(`web-terminal-tab-9:${leaf}`, {})], listed)).toBe(listed)
    expect(list([agentRow(`web-terminal-tab-9:${leaf}`, {})], []).map((s) => s.id)).toEqual([
      `server-7:claude:pane-tab-9:${leaf}`
    ])
  })

  it('shows the model this window knows on a record that has none', () => {
    const listed = [record({ surface: { kind: 'cli', paneKey: 'tab-1:0' } })]
    const sessions = list([agentRow('tab-1:0', { model: 'gpt-5.6' })], listed)
    expect(sessions.map((s) => [s.id, s.model])).toEqual([['server-7:claude:5f0c', 'gpt-5.6']])
  })
})
