import { describe, expect, it } from 'vitest'
import type { LiveSession } from '../../../shared/live-sessions/live-session-types'
import { mergeSealPanes, type SealPane } from './seal-pane-sessions'

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
