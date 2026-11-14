import { describe, expect, it } from 'vitest'
import type { AgentChildWorkView } from '../../../../../../shared/agent-status/child-work/agent-status-child-work-view'
import type { AgentStatusEntry } from '../../../../../../shared/agent-status/contracts/agent-status-types'
import { liveSessionPaneKeys } from '../../../../../../shared/live-sessions/live-session-pane-keys'
import type { TerminalTab } from '../../../../../../shared/workspace-layout/terminal-tab-types'
import { agentRowsWithoutSessionPanes } from './agent-rows-without-session-panes'
import { buildWorktreeAgentRows } from './worktree-agent-rows'

const NOW = 1_800_000_000_000
const CLAUDE_PANE = 'tab-claude:11111111-1111-4111-8111-111111111111'
const GEMINI_PANE = 'tab-gemini:22222222-2222-4222-8222-222222222222'

function tab(id: string): TerminalTab {
  return {
    id,
    ptyId: null,
    worktreeId: 'wt-1',
    title: id,
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: NOW
  }
}

function entry(paneKey: string, patch: Partial<AgentStatusEntry>): AgentStatusEntry {
  return {
    paneKey,
    worktreeId: 'wt-1',
    tabId: paneKey.split(':')[0],
    state: 'working',
    prompt: 'Review the plugin API',
    updatedAt: NOW,
    stateStartedAt: NOW - 60_000,
    stateHistory: [],
    ...patch
  }
}

const SUBAGENT: AgentChildWorkView = {
  id: 'a',
  providerId: 'task-a',
  kind: 'agent',
  name: 'plugin-dx',
  agentType: 'general-purpose',
  state: 'working',
  membership: 'live',
  firstObservedAt: NOW - 30_000,
  observedAt: NOW,
  stoppable: true,
  invocation: { invocationId: 'spawn-a', generation: 1 }
}

const ROWS = buildWorktreeAgentRows({
  tabs: [tab('tab-claude'), tab('tab-gemini')],
  entries: [
    entry(CLAUDE_PANE, { agentType: 'claude', children: [SUBAGENT] }),
    entry(GEMINI_PANE, { agentType: 'gemini' })
  ],
  retained: [],
  now: NOW
})

describe('agentRowsWithoutSessionPanes', () => {
  it('drops a pane that is a session record, with its subagents, and keeps other agents', () => {
    const sessionPanes = liveSessionPaneKeys([
      { inputRoutes: [{ kind: 'seal-pane', paneKey: CLAUDE_PANE }] },
      { inputRoutes: [{ kind: 'resume' }] }
    ])
    expect(ROWS).toHaveLength(3)
    expect(agentRowsWithoutSessionPanes(ROWS, sessionPanes).map((row) => row.paneKey)).toEqual([
      GEMINI_PANE
    ])
  })
})
