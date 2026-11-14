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

describe('what discovery adds to a Seal pane', () => {
  const found = (status: LiveSession['status'], statusSource: LiveSession['statusSource']) =>
    mergeSealPanes(
      [{ ...discovered, status, statusSource, statusDetail: 'Bash: pnpm test' }],
      [pane],
      local
    ).map((s) => [s.status, s.statusSource])

  it('shows the shell command a working pane runs', () => {
    expect(found('running-shell', 'process')).toEqual([['running-shell', 'process']])
  })

  it("keeps the hook's word over an approval guessed from the process list", () => {
    expect(found('needs-permission', 'process')).toEqual([['working', 'seal-hooks']])
  })
})
