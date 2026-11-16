import { describe, expect, it } from 'vitest'
import type { AgentPaneChange } from '../agent-hooks/observations/agent-transition-detector'
import type { AgentStatusIpcPayload } from '../../shared/agent-status/contracts/agent-status-ipc-payload'
import {
  structuredAgentSessionPaneKey,
  structuredAgentSessionTabId
} from '../../shared/agent-session/view/structured-agent-session-projection'
import type { LiveSession } from '../../shared/live-sessions/live-session-types'
import { LiveSessionSummaries, type LiveSessionSummariesDeps } from './live-session-summaries'
import type { SessionSummaryView } from './session-summarizer'

const PANE = 'tab-1:leaf-1'
const RECORD = 'local:claude:session-abc'
const CHAT_PANE = structuredAgentSessionPaneKey(structuredAgentSessionTabId('chat-1'), 'chat-1')
const WORKSPACE = { worktreeId: 'wt-1', sshHostId: null }

function row(overrides: Partial<AgentStatusIpcPayload>): AgentStatusIpcPayload {
  return {
    paneKey: PANE,
    state: 'done',
    agentType: 'claude',
    prompt: 'fix the login redirect',
    connectionId: null,
    receivedAt: 1_000,
    stateStartedAt: 1_000,
    providerSession: { key: 'session_id', id: 'session-abc' },
    ...overrides
  }
}

function moved(
  transition: Extract<AgentPaneChange, { kind: 'moved' }>['transition'],
  from: Extract<AgentPaneChange, { kind: 'moved' }>['from'],
  to: Extract<AgentPaneChange, { kind: 'moved' }>['to']
): AgentPaneChange {
  return { kind: 'moved', paneKey: PANE, workspace: WORKSPACE, from, to, at: 2_000, transition }
}

function session(overrides: Partial<LiveSession> = {}): LiveSession {
  return {
    id: RECORD,
    provider: 'claude',
    providerSessionId: 'session-abc',
    machine: { hostId: 'local', label: 'mac', kind: 'local', connection: 'local' },
    origin: 'seal',
    cwd: '/repo',
    project: 'repo',
    title: 'Fix login',
    status: 'your-turn',
    statusSource: 'seal-hooks',
    statusDetail: null,
    lastActivityAt: 1_000,
    startedAt: 500,
    alive: true,
    pid: 42,
    transcriptPath: '/t.jsonl',
    inputRoutes: [{ kind: 'seal-pane', paneKey: PANE }],
    permission: null,
    ...overrides
  }
}

function harness(options: { summarizeRegistry?: boolean } = {}) {
  let current: AgentStatusIpcPayload | null = null
  const calls: string[] = []
  const views = new Map<string, SessionSummaryView>()
  const summarizer: LiveSessionSummariesDeps['summarizer'] = {
    request: (key, message, asking) =>
      void calls.push(`request ${key} asking=${asking} ${message}`),
    clear: (key) => void calls.push(`clear ${key}`),
    forget: (key) => void calls.push(`forget ${key}`),
    view: (key) => views.get(key) ?? null
  }
  const transcriptReads: string[] = []
  const journalReads: string[] = []
  const panes = new LiveSessionSummaries({
    summarizer,
    readHookRow: () => current,
    lastAssistantText: async (sessionId) => {
      transcriptReads.push(sessionId)
      return 'From the transcript.'
    },
    chatLastAssistantText: async (chatSessionId) => {
      journalReads.push(chatSessionId)
      return 'The whole reply, from the journal.'
    },
    summarizeRegistry: options.summarizeRegistry ?? true,
    onChange: () => {},
    // The quiet window is the turn news's own; these tests fire it at once.
    setTimer: (run) => {
      run()
      return { cancel: () => {} }
    }
  })
  const settle = () => new Promise<void>((resolve) => setImmediate(resolve))
  return {
    panes,
    calls,
    views,
    transcriptReads,
    journalReads,
    settle,
    setRow: (next: AgentStatusIpcPayload | null) => {
      current = next
    }
  }
}

describe('LiveSessionSummaries for the panes of this host', () => {
  it('summarizes the last assistant message when a turn finishes', () => {
    const h = harness()
    h.setRow(row({ state: 'done', lastAssistantMessage: 'Patched the middleware.' }))

    h.panes.observePane(moved('turn-finished', 'working', 'done'))

    expect(h.calls).toEqual([`request ${RECORD} asking=false Patched the middleware.`])
  })

  it('leads with the ask when the agent stops on a question', () => {
    const h = harness()
    h.setRow(row({ state: 'waiting', lastAssistantMessage: 'Archive the rows or drop them?' }))

    h.panes.observePane(moved('needs-input', 'working', 'needs-you'))

    expect(h.calls).toEqual([`request ${RECORD} asking=true Archive the rows or drop them?`])
  })

  it('summarizes a lead turn that ended while its subagents still run', () => {
    const h = harness()
    h.setRow(row({ state: 'working' }))
    h.panes.observePane({
      kind: 'observed',
      paneKey: PANE,
      workspace: WORKSPACE,
      phase: 'working',
      at: 1
    })
    h.setRow(
      row({
        state: 'working',
        workingMode: 'monitoring',
        lastAssistantMessage: 'Waiting on the test-runner subagent.',
        mainAgent: { state: 'done', stateStartedAt: 1_500 }
      })
    )

    h.panes.observePane({
      kind: 'observed',
      paneKey: PANE,
      workspace: WORKSPACE,
      phase: 'working',
      at: 2
    })

    expect(h.calls).toEqual([`request ${RECORD} asking=false Waiting on the test-runner subagent.`])
  })

  it('never sends tool output or an approval prompt', () => {
    const h = harness()
    h.setRow(
      row({
        state: 'done',
        lastAssistantMessage: 'total 48\ndrwxr-xr-x  secrets',
        lastAssistantMessageIsToolOutput: true
      })
    )
    h.panes.observePane(moved('turn-finished', 'working', 'done'))
    h.setRow(row({ state: 'blocked', lastAssistantMessage: 'I will run the migration.' }))
    h.panes.observePane(moved('needs-input', 'working', 'needs-you'))

    expect(h.calls).toEqual([])
  })

  it('clears the summary when a new turn starts and forgets a closed pane', () => {
    const h = harness()
    h.setRow(row({ state: 'working' }))
    h.panes.observePane(moved('prompt-submitted', 'done', 'working'))
    h.setRow(null)
    h.panes.observePane(moved(null, 'working', 'rest'))

    expect(h.calls).toEqual([`clear ${RECORD}`, `forget ${RECORD}`])
  })

  it('summarizes a restored pane that already stopped, and lists it by its conversation', () => {
    const h = harness()
    h.views.set(RECORD, { text: 'Fixed the login redirect.', pending: false })
    h.setRow(row({ state: 'done', lastAssistantMessage: 'Patched the middleware.' }))

    h.panes.observePane({
      kind: 'seeded',
      paneKey: PANE,
      workspace: WORKSPACE,
      phase: 'done',
      at: 1
    })

    expect(h.calls).toEqual([`request ${RECORD} asking=false Patched the middleware.`])
    expect(h.panes.list()).toEqual([
      {
        paneKey: PANE,
        agentType: 'claude',
        providerSessionId: 'session-abc',
        text: 'Fixed the login redirect.',
        pending: false
      }
    ])
  })

  it('keeps one summary for a pane and its registry session, under the record id', async () => {
    const h = harness()
    h.setRow(row({ state: 'done', lastAssistantMessage: 'Patched the middleware.' }))
    h.panes.observePane(moved('turn-finished', 'working', 'done'))
    h.views.set(RECORD, { text: 'Fixed the login redirect.', pending: false })

    h.panes.observe({ type: 'upsert', revision: 1, session: session() })
    await h.settle()

    expect(h.transcriptReads).toEqual([])
    expect(h.calls).toEqual([`request ${RECORD} asking=false Patched the middleware.`])
    expect(h.panes.decorate(session()).summary).toBe('Fixed the login redirect.')
    expect(h.panes.paneView(PANE)?.text).toBe('Fixed the login redirect.')
  })

  it("summarizes a chat's finished turn from its journal, once per stop", async () => {
    const h = harness({ summarizeRegistry: false })
    const chat = row({
      paneKey: CHAT_PANE,
      structuredHost: 'owned',
      agentType: 'opencode',
      state: 'done',
      stateStartedAt: 3_000,
      lastAssistantMessage: 'The reply, clipped'
    })
    const change: AgentPaneChange = {
      ...moved('turn-finished', 'working', 'done'),
      paneKey: CHAT_PANE
    }
    h.setRow(chat)

    h.panes.observePane(change)
    h.panes.observePane(change)
    await h.settle()

    expect(h.journalReads).toEqual(['chat-1'])
    expect(h.calls).toEqual([
      'request local:opencode:session-abc asking=false The whole reply, from the journal.'
    ])
    h.views.set('local:opencode:session-abc', { text: 'Answered the question.', pending: false })
    expect(h.panes.paneView(CHAT_PANE)?.text).toBe('Answered the question.')
  })

  it('leads with the ask when a chat stops on a question and clears when it works again', async () => {
    const h = harness()
    const chat = (overrides: Partial<AgentStatusIpcPayload>) =>
      row({ paneKey: CHAT_PANE, structuredHost: 'owned', agentType: 'codex', ...overrides })
    const change: AgentPaneChange = {
      ...moved('needs-input', 'working', 'needs-you'),
      paneKey: CHAT_PANE
    }

    h.setRow(chat({ state: 'waiting', stateStartedAt: 3_000 }))
    h.panes.observePane(change)
    await h.settle()
    h.setRow(chat({ state: 'working', stateStartedAt: 4_000 }))
    h.panes.observePane(change)

    expect(h.calls).toEqual([
      'request local:codex:session-abc asking=true The whole reply, from the journal.',
      'clear local:codex:session-abc'
    ])
  })
})
