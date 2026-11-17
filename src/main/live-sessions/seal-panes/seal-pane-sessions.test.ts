import { describe, expect, it } from 'vitest'
import type { LiveSession } from '../../../shared/live-sessions/live-session-types'
import { sampleSessionSurface } from '../../../shared/live-sessions/live-session-surface.test-fixture'
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
  ...sampleSessionSurface(),
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
  lastMessage: null,
  receivedAt: 1000,
  permission: null,
  silent: false
}

describe('mergeSealPanes', () => {
  it("shows a Seal pane's agent once, under its real session id, before its first prompt lands", () => {
    expect(
      mergeSealPanes([discovered], [pane], local).map((s) => [s.id, s.origin, s.pid, s.status])
    ).toEqual([['local:claude:0e7d2c1a-0000-4000-8000-00000000000a', 'seal', 812, 'working']])
  })

  it('marks a pane session as a CLI in that pane, joined to a discovered session or not', () => {
    const copilot: SealPane = { ...pane, paneKey: 'tab-2:0', provider: 'copilot' }
    expect(
      mergeSealPanes([discovered], [pane, copilot], local).map((s) => [s.provider, s.surface])
    ).toEqual([
      ['claude', { kind: 'cli', paneKey: 'tab-1:0' }],
      ['copilot', { kind: 'cli', paneKey: 'tab-2:0' }]
    ])
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
  ) => sealPanesFromRows([row(patch)], prompt, 2000).map((p) => [p.status, p.statusDetail])

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

  it.each<[string, Partial<SealPaneRow>, LiveSession['status'], string | null]>([
    ['blocked on a tool', { state: 'blocked', toolName: 'Bash' }, 'needs-permission', null],
    ['waiting with no tool named', { state: 'waiting' }, 'waiting-input', 'Question for you'],
    [
      'waiting on a plan to review',
      { state: 'waiting', toolName: 'ExitPlanMode' },
      'waiting-input',
      'Question for you'
    ],
    ['working with no tool named', { state: 'working' }, 'working', null]
  ])('reads a row %s', (_, patch, status, detail) => {
    expect(statusOf(patch)).toEqual([[status, detail]])
  })

  it('reads a question asked through another tool from its prompt', () => {
    expect(
      statusOf({ state: 'waiting', toolName: 'mcp__ask' }, () => ({
        kind: 'question',
        promptId: 'p2',
        question: 'Which region?',
        options: [{ id: 'eu', label: 'EU' }]
      }))
    ).toEqual([['waiting-input', 'Question for you']])
  })

  it.each<[string, Partial<SealPaneRow>, unknown[]]>([
    [
      'a Copilot turn that finished',
      {
        agentType: 'copilot',
        state: 'done',
        providerSession: { key: 'session_id', id: 'cop-1', cwd: '/w' },
        lastAssistantMessage: 'Deployed.\nAll   checks pass.'
      },
      [['copilot', 'cop-1', 'your-turn', 'Deployed. All checks pass.']]
    ],
    [
      'an OpenCode turn at work',
      {
        agentType: 'opencode',
        toolName: 'bash',
        providerSession: { key: 'session_id', id: 'ses_9', cwd: '/w' },
        lastAssistantMessage: 'Running the build'
      },
      [['opencode', 'ses_9', 'working', 'Running the build']]
    ],
    [
      'an Amp pane, whose hooks name no session',
      { agentType: 'amp', providerSession: undefined },
      [['amp', 'pane-tab-1:0', 'working', null]]
    ],
    ['a Claude pane before its hooks name its session', { providerSession: undefined }, []],
    ['a chat, which its structured host lists', { structuredHost: 'owned' }, []],
    ['an agent the launcher does not know', { agentType: 'my-own-agent' }, []]
  ])('lists %s', (_, patch, expected) => {
    expect(
      sealPanesFromRows([row(patch)], () => null, 2000).map((p) => [
        p.provider,
        p.providerSessionId,
        p.status,
        p.lastMessage
      ])
    ).toEqual(expected)
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
      'your-turn',
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
      sealPanesFromRows([row(patch)], () => null, 2000).map((p) => [p.status, p.statusDetail])
    ).toEqual([[status, detail]])
  })
})

describe('a pane whose hooks no longer speak for its agent', () => {
  const HOUR = 60 * 60_000
  const row = (patch: Partial<SealPaneRow>): SealPaneRow => ({
    paneKey: 'tab-1:0',
    state: 'working',
    agentType: 'codex',
    providerSession: { key: 'session_id', id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', cwd: '/w' },
    receivedAt: 10 * HOUR,
    stateStartedAt: 10 * HOUR,
    connectionId: null,
    prompt: 'Deploy it',
    ...patch
  })
  const silent = (patch: Partial<SealPaneRow>, now: number) =>
    sealPanesFromRows([row(patch)], () => null, now)[0].silent

  it.each<[string, Partial<SealPaneRow>, number, boolean]>([
    ['a tool hook heard a minute ago', {}, 10 * HOUR + 60_000, false],
    ['a tool hook heard 31 minutes ago, and nothing since', {}, 10 * HOUR + 31 * 60_000, true],
    ['a prompt left open for 31 minutes', { state: 'waiting' }, 10 * HOUR + 31 * 60_000, true],
    ['a finished turn, however old', { state: 'done' }, 20 * HOUR, false],
    ['a row saved by the last run of Seal', { restoredUnconfirmed: true }, 10 * HOUR, true],
    [
      'a row replayed on reconnect, by when it was first seen',
      { receivedAt: 10 * HOUR + 40 * 60_000, evidenceObservedAt: 10 * HOUR },
      10 * HOUR + 41 * 60_000,
      true
    ]
  ])('%s', (_, patch, now, expected) => {
    expect(silent(patch, now)).toBe(expected)
  })

  it('shows what discovery reads instead, and asks the host to check the agent is there', () => {
    const asked: string[] = []
    const shown = mergeSealPanes(
      [
        {
          ...discovered,
          providerSessionId: pane.providerSessionId,
          status: 'done',
          statusSource: 'transcript',
          alive: false,
          pid: null
        }
      ],
      [{ ...pane, status: 'waiting-input', silent: true }],
      local,
      (paneKey) => asked.push(paneKey)
    ).map((s) => [s.status, s.statusSource])
    expect({ shown, asked }).toEqual({ shown: [['done', 'transcript']], asked: ['tab-1:0'] })
  })
})

describe('a turn cut short without a Stop hook', () => {
  const remote = { hostId: 'ssh-1', label: 'gpu-box', kind: 'remote' } as const
  const interrupted = (patch: Partial<SealPane>, lastActivityAt: number) =>
    mergeSealPanes(
      [
        {
          ...discovered,
          machine: patch.connectionId ? remote : local,
          status: 'your-turn',
          statusSource: 'transcript',
          statusDetail: 'Interrupted',
          lastActivityAt
        }
      ],
      [{ ...pane, status: 'working', receivedAt: 60_000, ...patch }],
      local
    ).map((s) => [s.status, s.statusDetail])

  it('ends when the transcript records the interrupt after the last hook', () => {
    expect(interrupted({}, 90_000)).toEqual([['your-turn', 'Interrupted']])
  })

  it('keeps working while the hook is the newer of the two', () => {
    expect(interrupted({}, 59_000)).toEqual([['working', null]])
  })

  it('keeps working on a remote pane, whose transcript is stamped by another clock', () => {
    expect(interrupted({ connectionId: 'ssh-1' }, 90_000)).toEqual([['working', null]])
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
    // A Stop hook does not say which subagents the turn left running, what it asked, or what it died of.
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
    // A wait on a background task belongs to a turn the hook saw end.
    ['your-turn', 'waiting-task', 'transcript', 'your-turn', 'seal-hooks'],
    // The hook's inventory says subagents run; discovery says how many.
    ['waiting-subagent', 'waiting-subagent', 'transcript', 'waiting-subagent', 'transcript'],
    ['waiting-subagent', 'your-turn', 'transcript', 'waiting-subagent', 'seal-hooks'],
    // A prompt and a failure are the hooks' to report.
    ['needs-permission', 'working', 'transcript', 'needs-permission', 'seal-hooks'],
    ['waiting-input', 'your-turn', 'transcript', 'waiting-input', 'seal-hooks'],
    ['errored', 'your-turn', 'transcript', 'errored', 'seal-hooks'],
    // A guess never outranks a hook.
    ['your-turn', 'waiting-subagent', 'classifier', 'your-turn', 'seal-hooks']
  ])('hooks say %s, discovery read %s from %s: shows %s', (hooks, read, from, shows, word) => {
    expect(merged(hooks, read, from)).toEqual([shows, word])
  })

  // By the last-turn rule, or by the judge of a paired server.
  it.each(['transcript', 'classifier'] as const)(
    'hooks say your-turn, discovery read the ended turn waiting on a command it started (%s): shows waiting-task',
    (statusSource) => {
      const waiting: LiveSession = {
        ...discovered,
        status: 'waiting-task',
        statusSource,
        backgroundWait: { reply: null, endedAt: null, registry: 'shell', commands: [] }
      }
      expect(
        mergeSealPanes([waiting], [{ ...pane, status: 'your-turn' }], local).map((s) => [
          s.status,
          s.statusSource
        ])
      ).toEqual([['waiting-task', statusSource]])
    }
  )
})
