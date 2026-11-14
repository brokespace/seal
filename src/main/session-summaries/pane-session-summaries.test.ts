import { describe, expect, it } from 'vitest'
import type { AgentPaneChange } from '../agent-hooks/observations/agent-transition-detector'
import type { AgentStatusIpcPayload } from '../../shared/agent-status/contracts/agent-status-ipc-payload'
import { PaneSessionSummaries, type PaneSessionSummariesDeps } from './pane-session-summaries'

const PANE = 'tab-1:leaf-1'
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

function harness() {
  let current: AgentStatusIpcPayload | null = null
  const calls: string[] = []
  const summarizer: PaneSessionSummariesDeps['summarizer'] = {
    request: (key, message, asking) =>
      void calls.push(`request ${key} asking=${asking} ${message}`),
    clear: (key) => void calls.push(`clear ${key}`),
    forget: (key) => void calls.push(`forget ${key}`),
    view: () => ({ text: 'Fixed the login redirect.', pending: false })
  }
  const panes = new PaneSessionSummaries({
    summarizer,
    readHookRow: () => current,
    // The quiet window is the turn news's own; these tests fire it at once.
    setTimer: (run) => {
      run()
      return { cancel: () => {} }
    }
  })
  return {
    panes,
    calls,
    setRow: (next: AgentStatusIpcPayload | null) => {
      current = next
    }
  }
}

describe('PaneSessionSummaries', () => {
  it('summarizes the last assistant message when a turn finishes', () => {
    const h = harness()
    h.setRow(row({ state: 'done', lastAssistantMessage: 'Patched the middleware.' }))

    h.panes.observe(moved('turn-finished', 'working', 'done'))

    expect(h.calls).toEqual([`request pane:${PANE} asking=false Patched the middleware.`])
  })

  it('leads with the ask when the agent stops on a question', () => {
    const h = harness()
    h.setRow(row({ state: 'waiting', lastAssistantMessage: 'Archive the rows or drop them?' }))

    h.panes.observe(moved('needs-input', 'working', 'needs-you'))

    expect(h.calls).toEqual([`request pane:${PANE} asking=true Archive the rows or drop them?`])
  })

  it('summarizes a lead turn that ended while its subagents still run', () => {
    const h = harness()
    h.setRow(row({ state: 'working' }))
    h.panes.observe({
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

    h.panes.observe({
      kind: 'observed',
      paneKey: PANE,
      workspace: WORKSPACE,
      phase: 'working',
      at: 2
    })

    expect(h.calls).toEqual([
      `request pane:${PANE} asking=false Waiting on the test-runner subagent.`
    ])
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
    h.panes.observe(moved('turn-finished', 'working', 'done'))
    h.setRow(row({ state: 'blocked', lastAssistantMessage: 'I will run the migration.' }))
    h.panes.observe(moved('needs-input', 'working', 'needs-you'))

    expect(h.calls).toEqual([])
  })

  it('clears the summary when a new turn starts and forgets a closed pane', () => {
    const h = harness()
    h.setRow(row({ state: 'working' }))
    h.panes.observe(moved('prompt-submitted', 'done', 'working'))
    h.setRow(null)
    h.panes.observe(moved(null, 'working', 'rest'))

    expect(h.calls).toEqual([`clear pane:${PANE}`, `forget pane:${PANE}`])
  })

  it('summarizes a restored pane that already stopped, and lists it by its conversation', () => {
    const h = harness()
    h.setRow(row({ state: 'done', lastAssistantMessage: 'Patched the middleware.' }))

    h.panes.observe({ kind: 'seeded', paneKey: PANE, workspace: WORKSPACE, phase: 'done', at: 1 })

    expect(h.calls).toEqual([`request pane:${PANE} asking=false Patched the middleware.`])
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
})
