import { describe, expect, it } from 'vitest'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import { orcaHomeSessionFromCard, orcaHomeSessionState } from './orca-home-session-mapping'

function card(overrides: Partial<DashboardCard> = {}): DashboardCard {
  return {
    paneKey: 'tab-1:leaf-1',
    ptyId: null,
    agentType: 'claude',
    bucket: 'working',
    dotState: 'working',
    task: 'Fix flaky test',
    repoId: 'repo-1',
    worktreeId: 'wt-1',
    tabId: 'tab-1',
    leafId: 'leaf-1',
    repoName: 'seal',
    worktreeName: 'fix-flaky',
    startedAt: 1_000,
    finishedAt: null,
    stateChangedAt: 2_000,
    unseen: false,
    ...overrides
  }
}

const context = { localMachineLabel: 'Local Linux', activeAccounts: { claude: 'me@example.com' } }

describe('orcaHomeSessionState', () => {
  it('treats a pending tool call as a permission request', () => {
    expect(orcaHomeSessionState({ dotState: 'waiting' }, { toolName: 'Bash' })).toBe('permission')
  })

  it('treats a question as waiting on the user even when it arrives as a tool', () => {
    expect(orcaHomeSessionState({ dotState: 'waiting' }, { toolName: 'AskUserQuestion' })).toBe(
      'waiting'
    )
    expect(
      orcaHomeSessionState({ dotState: 'blocked' }, { toolName: 'Edit', interactivePrompt: '{}' })
    ).toBe('waiting')
  })

  it('reports a failed turn as errored regardless of the dot state', () => {
    expect(orcaHomeSessionState({ dotState: 'done', verdict: 'failed' }, undefined)).toBe('errored')
  })

  it('keeps an interrupted turn as done', () => {
    expect(orcaHomeSessionState({ dotState: 'done', verdict: 'interrupted' }, undefined)).toBe(
      'done'
    )
  })
})

describe('orcaHomeSessionFromCard', () => {
  it('attributes local sessions to the active account and prefers the agent reply', () => {
    const session = orcaHomeSessionFromCard(
      card({ lastAgentMessage: 'All tests pass', lastUserMessage: 'run tests' }),
      { model: 'claude-opus-4' },
      context
    )
    expect(session).toMatchObject({
      machineId: 'local',
      machineLabel: 'Local Linux',
      account: 'me@example.com',
      model: 'claude-opus-4',
      agentLabel: 'Claude',
      title: 'Fix flaky test',
      lastMessage: { role: 'agent', text: 'All tests pass' }
    })
  })

  it('leaves the account unknown on remote hosts and names the machine by its host label', () => {
    const session = orcaHomeSessionFromCard(
      card({ executionHostId: 'ssh:box', hostLabel: 'build-box', conversationName: 'Refactor' }),
      undefined,
      context
    )
    expect(session.account).toBeUndefined()
    expect(session).toMatchObject({
      machineId: 'ssh:box',
      machineLabel: 'build-box',
      title: 'Refactor'
    })
    expect(session.target).toEqual({
      kind: 'orca-pane',
      reveal: {
        repoId: 'repo-1',
        worktreeId: 'wt-1',
        executionHostId: 'ssh:box',
        tabId: 'tab-1',
        leafId: 'leaf-1'
      }
    })
  })
})
