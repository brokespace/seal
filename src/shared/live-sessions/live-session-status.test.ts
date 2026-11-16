import { describe, expect, it } from 'vitest'
import type { AgentSessionStatusEvidence } from './adapters/agent-session-adapter'
import { liveSessionStatusFromEvidence } from './live-session-status'
import type { LiveSessionStatus } from './live-session-types'

const nothing: AgentSessionStatusEvidence = {
  turnRunning: false,
  shellRunning: false,
  pendingApproval: false,
  pendingQuestion: false,
  turnFailed: false,
  runningSubagents: 0,
  runningBackgroundTasks: 0,
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
      'the turn ended and background tasks run',
      { ...tookTurn, runningBackgroundTasks: 1 },
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
      'a question with background tasks running',
      { ...tookTurn, pendingQuestion: true, runningBackgroundTasks: 1 },
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
      'a running turn with background tasks behind it',
      { ...inTurn, runningBackgroundTasks: 2 },
      'working'
    ],
    ['a new turn after a failed one', { ...inTurn, turnFailed: true }, 'working'],
    [
      'a failed turn with tasks still running',
      { ...tookTurn, turnFailed: true, runningBackgroundTasks: 1, runningSubagents: 1 },
      'errored'
    ],
    [
      'subagents and background tasks behind an ended turn',
      { ...tookTurn, runningSubagents: 1, runningBackgroundTasks: 3 },
      'waiting-subagent'
    ],
    ['a shell flag with no turn running', { ...tookTurn, shellRunning: true }, 'your-turn'],
    ['background tasks before any turn', { runningBackgroundTasks: 1 }, 'waiting-task'],
    ['a failed first turn', { turnFailed: true }, 'errored']
  ])('%s', (_, evidence, status) => {
    expect(liveSessionStatusFromEvidence({ ...nothing, ...evidence })).toBe(status)
  })
})
