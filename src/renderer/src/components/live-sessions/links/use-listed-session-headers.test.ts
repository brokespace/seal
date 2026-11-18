import { expect, it } from 'vitest'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { sampleLiveSession, SAMPLE_NOW } from '../live-session.test-fixture'
import { listedSessionHeaders } from './use-listed-session-headers'

const FITNESS = 'active-agents:project:fitness'
const OPS = 'active-agents:project:ops'
const UNASSIGNED = 'active-agents:unassigned'
const DAY = 24 * 60 * 60 * 1000

const GROUPS = {
  sessionHeaders: [
    { key: FITNESS, name: 'fitness' },
    { key: OPS, name: 'Ops' },
    { key: UNASSIGNED, name: null }
  ],
  byHeader: new Map<string, LiveSession[]>([
    [FITNESS, [sampleLiveSession('idle'), sampleLiveSession('working', { status: 'working' })]],
    // Ended two days ago: no longer listed, so it holds no header up.
    [
      OPS,
      [
        sampleLiveSession('old', {
          status: 'done',
          alive: false,
          lastActivityAt: SAMPLE_NOW - 2 * DAY
        })
      ]
    ],
    [UNASSIGNED, [sampleLiveSession('no-folder', { cwd: null, project: null })]]
  ])
}

it('brings a header to the list only while it has a session row to show', () => {
  expect(listedSessionHeaders(GROUPS, SAMPLE_NOW, 'None')).toEqual([
    { key: FITNESS, label: 'fitness', project: 'fitness', count: 2 },
    { key: UNASSIGNED, label: 'None', project: null, count: 1 }
  ])
})
