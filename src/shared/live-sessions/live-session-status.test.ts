import { describe, expect, it } from 'vitest'
import type { AgentSessionStatusEvidence } from './adapters/agent-session-adapter'
import { isActiveLiveSession, liveSessionStatusFromEvidence } from './live-session-status'
import type { AgentSessionSurface, LiveSessionStatus } from './live-session-types'

const nothing: AgentSessionStatusEvidence = {
  turnRunning: false,
  shellRunning: false,
  pendingApproval: false,
  pendingQuestion: false,
  turnFailed: false,
  runningSubagents: 0,
  waitsOnBackgroundTask: false,
  hadTurn: false,
  ended: false
}
const tookTurn = { hadTurn: true }
const inTurn = { hadTurn: true, turnRunning: true }

describe('the status a chat or a hook row reports', () => {
  it.each<[string, Partial<AgentSessionStatusEvidence>, LiveSessionStatus]>([
    ['an approval is pending', { ...inTurn, pendingApproval: true }, 'needs-permission'],
    ['a question is pending', { ...inTurn, pendingQuestion: true }, 'waiting-input'],
    ['the last turn failed', { ...tookTurn, turnFailed: true }, 'errored'],
    ['a turn runs a foreground shell command', { ...inTurn, shellRunning: true }, 'running-shell'],
    ['a turn runs', inTurn, 'working'],
    ['the turn ended and subagents run', { ...tookTurn, runningSubagents: 2 }, 'waiting-subagent'],
    [
      'a turn waits on a command it started earlier',
      { ...inTurn, waitsOnBackgroundTask: true },
      'waiting-task'
    ],
    ['the turn ended with nothing running', tookTurn, 'your-turn'],
    ['no turn was taken yet', {}, 'idle'],
    ['the session closed', { ...tookTurn, ended: true }, 'done']
  ])('%s', (_, evidence, status) => {
    expect(liveSessionStatusFromEvidence({ ...nothing, ...evidence })).toBe(status)
  })
})

describe('which evidence wins when a session reports several', () => {
  it.each<[string, Partial<AgentSessionStatusEvidence>, LiveSessionStatus]>([
    [
      'ended, with a prompt up and a turn running',
      { ...inTurn, ended: true, pendingApproval: true, pendingQuestion: true, shellRunning: true },
      'done'
    ],
    ['ended with work left running', { ...tookTurn, ended: true, runningSubagents: 1 }, 'done'],
    ['ended after a failed turn', { ...tookTurn, ended: true, turnFailed: true }, 'errored'],
    [
      'an approval and a question',
      { ...inTurn, pendingApproval: true, pendingQuestion: true },
      'needs-permission'
    ],
    [
      'an approval after a failed turn',
      { ...tookTurn, pendingApproval: true, turnFailed: true },
      'needs-permission'
    ],
    [
      'a question in a turn that runs a shell command',
      { ...inTurn, pendingQuestion: true, shellRunning: true },
      'waiting-input'
    ],
    [
      'a question in a turn that waits on a background task',
      { ...inTurn, pendingQuestion: true, waitsOnBackgroundTask: true },
      'waiting-input'
    ],
    [
      'a turn that runs a shell command and waits on subagents',
      { ...inTurn, shellRunning: true, runningSubagents: 1 },
      'running-shell'
    ],
    [
      'a running turn that waits on subagents',
      { ...inTurn, runningSubagents: 1 },
      'waiting-subagent'
    ],
    [
      'a running turn that waits on subagents and on a background task',
      { ...inTurn, runningSubagents: 1, waitsOnBackgroundTask: true },
      'waiting-subagent'
    ],
    [
      'a turn that runs a shell command and waits on a background task',
      { ...inTurn, shellRunning: true, waitsOnBackgroundTask: true },
      'running-shell'
    ],
    ['a new turn after a failed one', { ...inTurn, turnFailed: true }, 'working'],
    [
      'a failed turn with subagents still running',
      { ...tookTurn, turnFailed: true, runningSubagents: 1 },
      'errored'
    ],
    // A wait belongs to a turn: once it ended, what it left running holds nothing.
    ['a wait flag with no turn running', { ...tookTurn, waitsOnBackgroundTask: true }, 'your-turn'],
    ['a shell flag with no turn running', { ...tookTurn, shellRunning: true }, 'your-turn'],
    ['a wait flag before any turn', { waitsOnBackgroundTask: true }, 'idle'],
    ['a failed first turn', { turnFailed: true }, 'errored']
  ])('%s', (_, evidence, status) => {
    expect(liveSessionStatusFromEvidence({ ...nothing, ...evidence })).toBe(status)
  })
})

describe('which sessions count as still running', () => {
  const chat: AgentSessionSurface = { kind: 'chat', sessionId: 'chat-1', tabId: 'tab-1' }
  const external: AgentSessionSurface = { kind: 'external' }

  it.each<
    [string, { alive: boolean; status: LiveSessionStatus; surface: AgentSessionSurface }, boolean]
  >([
    [
      'a chat at its prompt whose agent rests',
      { alive: false, status: 'your-turn', surface: chat },
      true
    ],
    ['a new chat nobody has written to', { alive: false, status: 'idle', surface: chat }, true],
    ['a closed chat', { alive: false, status: 'done', surface: chat }, false],
    [
      'a chat whose last turn failed and whose agent is gone',
      { alive: false, status: 'errored', surface: chat },
      false
    ],
    [
      'a terminal agent that exited at its prompt',
      { alive: false, status: 'your-turn', surface: external },
      false
    ],
    [
      'a terminal agent at its prompt',
      { alive: true, status: 'your-turn', surface: external },
      true
    ],
    [
      'a busy agent on a host that lists no processes',
      { alive: false, status: 'working', surface: external },
      true
    ]
  ])('%s', (_, session, active) => {
    expect(isActiveLiveSession(session)).toBe(active)
  })
})
