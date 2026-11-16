import { describe, expect, it } from 'vitest'
import type {
  LiveSession,
  LiveSessionStatus,
  LiveSessionStatusSource
} from '../../shared/live-sessions/live-session-types'
import { sampleSessionSurface } from '../../shared/live-sessions/live-session-surface.test-fixture'
import { LiveSessionStatusHold } from './live-session-status-hold'

const T0 = 1_000_000

function session(
  status: LiveSessionStatus,
  statusSource: LiveSessionStatusSource = 'transcript',
  statusDetail: string | null = null
): LiveSession {
  return {
    id: 'local:claude:a',
    provider: 'claude',
    providerSessionId: 'a',
    machine: { hostId: 'local', label: 'dev-box', kind: 'local' },
    origin: 'external',
    ...sampleSessionSurface(),
    cwd: '/srv/shop',
    project: 'shop',
    title: null,
    status,
    statusSource,
    statusDetail,
    lastActivityAt: T0,
    startedAt: null,
    alive: true,
    pid: 4100,
    transcriptPath: null,
    inputRoutes: [],
    permission: null
  }
}

/** What is shown after each reading, given as `[status, source, scan, msAfterStart]`. */
function shown(
  readings: [LiveSessionStatus, LiveSessionStatusSource, number, number][]
): LiveSessionStatus[] {
  const hold = new LiveSessionStatusHold()
  return readings.map(
    ([status, source, scan, ms]) => hold.settle(session(status, source), scan, T0 + ms).status
  )
}

describe('LiveSessionStatusHold', () => {
  it('keeps a busy session busy until a second scan agrees it stopped', () => {
    expect(
      shown([
        ['working', 'transcript', 1, 0],
        ['your-turn', 'transcript', 2, 3_000],
        ['your-turn', 'transcript', 3, 6_000]
      ])
    ).toEqual(['working', 'working', 'your-turn'])
  })

  it('never shows a stop that the next scan takes back', () => {
    expect(
      shown([
        ['running-shell', 'process', 1, 0],
        ['your-turn', 'transcript', 2, 3_000],
        ['working', 'transcript', 3, 6_000],
        ['waiting-input', 'transcript', 4, 9_000]
      ])
    ).toEqual(['running-shell', 'running-shell', 'working', 'working'])
  })

  it('keeps what the session was doing while it holds', () => {
    const hold = new LiveSessionStatusHold()
    hold.settle(session('running-shell', 'process', 'Bash: pnpm test'), 1, T0)
    expect(hold.settle(session('your-turn'), 2, T0 + 3_000)).toMatchObject({
      status: 'running-shell',
      statusSource: 'process',
      statusDetail: 'Bash: pnpm test'
    })
  })

  it('keeps what a waiting session waits on while it holds', () => {
    const hold = new LiveSessionStatusHold()
    const watcher = (status: 'running' | 'failed') => ({
      subagents: [],
      todos: [],
      tasks: [{ id: 'bash_1', label: 'tail -F run.log', status, startedAt: T0, summary: null }]
    })
    hold.settle({ ...session('waiting-task'), activity: watcher('running') }, 1, T0)
    const held = hold.settle(
      { ...session('your-turn'), activity: watcher('failed') },
      2,
      T0 + 3_000
    )
    expect([held.status, held.activity?.tasks.map((task) => task.status)]).toEqual([
      'waiting-task',
      ['running']
    ])
  })

  it('does not wait for a second scan on a republish between scans', () => {
    expect(
      shown([
        ['working', 'transcript', 1, 0],
        ['your-turn', 'transcript', 2, 3_000],
        ['your-turn', 'transcript', 2, 3_100]
      ])
    ).toEqual(['working', 'working', 'working'])
  })

  it.each([
    ['needs-permission', 'process'],
    ['needs-permission', 'screen'],
    ['errored', 'transcript'],
    ['your-turn', 'seal-hooks'],
    ['waiting-input', 'agent-hooks'],
    ['waiting-subagent', 'transcript']
  ] as const)('shows %s from %s at once', (status, source) => {
    expect(
      shown([
        ['working', 'transcript', 1, 0],
        [status, source, 2, 3_000]
      ])
    ).toEqual(['working', status])
  })

  it('lets go when the host stops answering', () => {
    expect(
      shown([
        ['working', 'transcript', 1, 0],
        ['your-turn', 'transcript', 2, 3_000],
        ['your-turn', 'transcript', 2, 23_000]
      ])
    ).toEqual(['working', 'working', 'your-turn'])
  })
})
