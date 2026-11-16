import { describe, expect, it } from 'vitest'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { sampleLiveSession as session, SAMPLE_NOW as NOW } from '../live-session.test-fixture'
import { buildActiveAgents } from './active-agents-model'

const HOUR = 3_600_000

const BUILD_BOX = { hostId: 'ssh-1', label: 'build-box', kind: 'remote' } as const

const ids = (sessions: readonly LiveSession[]) => sessions.map((s) => s.id)

describe('buildActiveAgents', () => {
  it('groups by machine, this one first, each sorted attention, working, idle', () => {
    const view = buildActiveAgents(
      [
        session('remote-idle', { machine: BUILD_BOX }),
        session('idle'),
        session('waiting-on-subagents', { status: 'waiting-subagent' }),
        session('working', { status: 'working' }),
        session('asks', { status: 'waiting-input' }),
        session('permission', { status: 'needs-permission' }),
        session('remote-errored', { machine: BUILD_BOX, status: 'errored' })
      ],
      NOW
    )
    expect(view.machines.map((m) => [m.label, ids(m.sessions)])).toEqual([
      ['brian-mbp', ['permission', 'asks', 'working', 'waiting-on-subagents', 'idle']],
      ['build-box', ['remote-errored', 'remote-idle']]
    ])
    expect(view.activeCount).toBe(7)
  })

  it('puts pinned sessions above the rest of their machine', () => {
    const view = buildActiveAgents(
      [session('permission', { status: 'needs-permission' }), session('pinned', { pinned: true })],
      NOW
    )
    expect(ids(view.machines[0].sessions)).toEqual(['pinned', 'permission'])
  })

  it('lists ended sessions of the last day under finished, newest first, and drops older ones', () => {
    const ended = { alive: false, status: 'done' } as const
    const view = buildActiveAgents(
      [
        session('running'),
        session('ended-yesterday', { ...ended, lastActivityAt: NOW - 30 * HOUR }),
        session('ended-this-morning', { ...ended, lastActivityAt: NOW - 5 * HOUR }),
        session('ended-just-now', { ...ended, lastActivityAt: NOW - 60_000 })
      ],
      NOW
    )
    expect(ids(view.machines[0].sessions)).toEqual(['running'])
    expect(ids(view.finished)).toEqual(['ended-just-now', 'ended-this-morning'])
  })
})
