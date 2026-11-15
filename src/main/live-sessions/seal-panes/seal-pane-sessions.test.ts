import { describe, expect, it } from 'vitest'
import type { LiveSession } from '../../../shared/live-sessions/live-session-types'
import {
  mergeSealPanes,
  sealPanesFromRows,
  type SealPane,
  type SealPaneRow
} from './seal-pane-sessions'

const local = { hostId: 'local', label: 'mbp', kind: 'local' } as const

const discovered: LiveSession = {
  id: 'local:claude:pid-812',
  provider: 'claude',
  providerSessionId: 'pid-812',
  machine: local,
  origin: 'external',
  cwd: '/w',
  project: 'w',
  title: null,
  status: 'waiting-input',
  statusSource: 'transcript',
  statusDetail: null,
  lastActivityAt: 0,
  startedAt: null,
  alive: true,
  pid: 812,
  transcriptPath: null,
  inputRoutes: [],
  permission: null
}

const pane: SealPane = {
  paneKey: 'tab-1:0',
  provider: 'claude',
  providerSessionId: '0e7d2c1a-0000-4000-8000-00000000000a',
  connectionId: null,
  status: 'working',
  statusDetail: null,
  cwd: '/w',
  transcriptPath: null,
  prompt: 'Deploy it',
  receivedAt: 1000,
  permission: null
}

describe('mergeSealPanes', () => {
  it("shows a Seal pane's agent once, under its real session id, before its first prompt lands", () => {
    expect(
      mergeSealPanes([discovered], [pane], local).map((s) => [s.id, s.origin, s.pid, s.status])
    ).toEqual([['local:claude:0e7d2c1a-0000-4000-8000-00000000000a', 'seal', 812, 'working']])
  })
})

describe('sealPanesFromRows', () => {
  const row = (patch: Partial<SealPaneRow>): SealPaneRow => ({
    paneKey: 'tab-1:0',
    state: 'working',
    agentType: 'claude',
    providerSession: { key: 'session_id', id: '0e7d2c1a-0000-4000-8000-00000000000a', cwd: '/w' },
    receivedAt: 1000,
    stateStartedAt: 1000,
    connectionId: null,
    prompt: 'Deploy it',
    ...patch
  })
  const statusOf = (
    patch: Partial<SealPaneRow>,
    prompt: Parameters<typeof sealPanesFromRows>[1] = () => null
  ) => sealPanesFromRows([row(patch)], prompt).map((p) => [p.status, p.statusDetail])

  it('reads a finished turn as waiting on the user', () => {
    expect(statusOf({ state: 'done' })).toEqual([['your-turn', null]])
  })

  it('tells a permission request from a question, though the hook reports both as waiting', () => {
    expect(
      statusOf({ state: 'waiting', toolName: 'Bash' }, () => ({
        kind: 'approval',
        promptId: 'p1',
        tool: 'Bash',
        summary: 'rm -rf dist',
        options: [{ id: 'allow', label: 'Yes' }]
      }))[0][0]
    ).toBe('needs-permission')
    expect(statusOf({ state: 'waiting', toolName: 'Bash' })).toEqual([
      ['needs-permission', 'Allow Bash?']
    ])
    expect(statusOf({ state: 'waiting', toolName: 'AskUserQuestion' })).toEqual([
      ['waiting-input', 'Question for you']
    ])
  })
})

describe('what a pane row says of a turn that stopped', () => {
  const row = (patch: Partial<SealPaneRow>): SealPaneRow => ({
    paneKey: 'tab-1:0',
    state: 'done',
    agentType: 'claude',
    providerSession: { key: 'session_id', id: '0e7d2c1a-0000-4000-8000-00000000000a', cwd: '/w' },
    receivedAt: 1000,
    stateStartedAt: 1000,
    connectionId: null,
    prompt: 'Deploy it',
    ...patch
  })
  const done = { state: 'done', stateStartedAt: 900 } as const

  it.each<[string, Partial<SealPaneRow>, LiveSession['status'], string | null]>([
    ['finished', { mainAgent: { ...done, outcome: 'success' } }, 'your-turn', null],
    ['failed', { mainAgent: { ...done, outcome: 'failure' } }, 'errored', null],
    ['was stopped by the user', { interrupted: true }, 'your-turn', 'Interrupted'],
    [
      'left a watcher running',
      { state: 'working', workingMode: 'monitoring', mainAgent: done },
      'waiting-task',
      null
    ],
    ['left a subagent running', { state: 'working', mainAgent: done }, 'waiting-subagent', null],
    [
      'failed with a watcher still running',
      {
        state: 'working',
        workingMode: 'monitoring',
        mainAgent: { ...done, outcome: 'failure' }
      },
      'errored',
      null
    ],
    [
      'did not stop: a tool runs',
      { state: 'working', toolName: 'Edit', mainAgent: { state: 'working', stateStartedAt: 900 } },
      'working',
      'Edit'
    ]
  ])('a turn that %s', (_, patch, status, detail) => {
    expect(
      sealPanesFromRows([row(patch)], () => null).map((p) => [p.status, p.statusDetail])
    ).toEqual([[status, detail]])
  })
})

describe('what discovery adds to a Seal pane', () => {
  type Source = LiveSession['statusSource']
  type Status = LiveSession['status']
  const merged = (hooks: Status, status: Status, statusSource: Source) =>
    mergeSealPanes(
      [{ ...discovered, status, statusSource, statusDetail: 'from discovery' }],
      [{ ...pane, status: hooks }],
      local
    ).map((s) => [s.status, s.statusSource])[0]

  // [the pane's hooks, what discovery read and from where, what shows and whose word it is]
  it.each<[Status, Status, Source, Status, Source]>([
    // A Stop hook does not say what the turn left running, asked, or died of.
    ['your-turn', 'waiting-task', 'transcript', 'waiting-task', 'transcript'],
    ['your-turn', 'waiting-task', 'agent-state', 'waiting-task', 'agent-state'],
    ['your-turn', 'waiting-subagent', 'transcript', 'waiting-subagent', 'transcript'],
    ['your-turn', 'waiting-input', 'transcript', 'waiting-input', 'transcript'],
    ['your-turn', 'errored', 'transcript', 'errored', 'transcript'],
    // Claude says a turn runs that no hook announced.
    ['your-turn', 'working', 'agent-state', 'working', 'agent-state'],
    ['your-turn', 'needs-permission', 'agent-state', 'needs-permission', 'agent-state'],
    // A transcript still being written does not outrank a Stop hook.
    ['your-turn', 'working', 'transcript', 'your-turn', 'seal-hooks'],
    ['your-turn', 'done', 'transcript', 'your-turn', 'seal-hooks'],
    // A tool hook does not say the command it started, or that the turn since ended on a wait.
    ['working', 'running-shell', 'process', 'running-shell', 'process'],
    ['working', 'waiting-subagent', 'transcript', 'waiting-subagent', 'transcript'],
    ['working', 'waiting-task', 'transcript', 'waiting-task', 'transcript'],
    ['working', 'needs-permission', 'agent-state', 'needs-permission', 'agent-state'],
    // An approval guessed from the process list, or a turn end not yet hooked, is not news.
    ['working', 'needs-permission', 'process', 'working', 'seal-hooks'],
    ['working', 'your-turn', 'transcript', 'working', 'seal-hooks'],
    ['working', 'errored', 'transcript', 'working', 'seal-hooks'],
    // The hook's inventory says work runs; discovery says which kind.
    ['waiting-task', 'waiting-subagent', 'transcript', 'waiting-subagent', 'transcript'],
    ['waiting-task', 'your-turn', 'transcript', 'waiting-task', 'seal-hooks'],
    // A prompt and a failure are the hooks' to report.
    ['needs-permission', 'working', 'transcript', 'needs-permission', 'seal-hooks'],
    ['waiting-input', 'your-turn', 'transcript', 'waiting-input', 'seal-hooks'],
    ['errored', 'your-turn', 'transcript', 'errored', 'seal-hooks'],
    // A guess never outranks a hook.
    ['your-turn', 'waiting-task', 'classifier', 'your-turn', 'seal-hooks']
  ])('hooks say %s, discovery read %s from %s: shows %s', (hooks, read, from, shows, word) => {
    expect(merged(hooks, read, from)).toEqual([shows, word])
  })
})
