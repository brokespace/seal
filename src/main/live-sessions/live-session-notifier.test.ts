import { describe, expect, it } from 'vitest'
import type { LiveSession } from '../../shared/live-sessions/live-session-types'
import { LiveSessionNotifier, type LiveSessionNotification } from './live-session-notifier'

const base: LiveSession = {
  id: 'box:claude:s1',
  provider: 'claude',
  providerSessionId: 's1',
  machine: { hostId: 'box', label: 'build-box', kind: 'remote' },
  origin: 'external',
  cwd: '/srv/shop',
  project: 'shop',
  title: 'Fix the coupon bug',
  status: 'working',
  statusSource: 'transcript',
  statusDetail: null,
  lastActivityAt: 0,
  startedAt: null,
  alive: true,
  pid: 4100,
  transcriptPath: null,
  inputRoutes: [],
  permission: null
}

function watch() {
  const shown: LiveSessionNotification[] = []
  const notifier = new LiveSessionNotifier({ wanted: () => true, show: (n) => shown.push(n) })
  let revision = 0
  const see = (session: Partial<LiveSession>) =>
    notifier.onEvent({ type: 'upsert', revision: ++revision, session: { ...base, ...session } })
  return { shown, see, notifier }
}

describe('session notifications', () => {
  it('stay quiet while an agent waits on its own subagents, and speak when the turn ends', () => {
    const { shown, see } = watch()
    see({ status: 'working' })
    see({ status: 'waiting-subagent', statusDetail: 'Waiting on 2 subagents' })
    see({ status: 'working' })
    expect(shown).toEqual([])

    see({ status: 'waiting-task' })
    see({ status: 'idle', lastMessage: 'Both reviews are in; nothing blocking.' })
    expect(shown).toEqual([
      {
        sessionId: 'box:claude:s1',
        kind: 'finished',
        title: 'Fix the coupon bug',
        body: 'Claude Code on build-box finished: Both reviews are in; nothing blocking.'
      }
    ])
  })

  it('say what a session asks for, once', () => {
    const { shown, see } = watch()
    see({ status: 'working' })
    const asking = {
      status: 'needs-permission' as const,
      permission: { promptId: 'p1', question: 'Allow Bash: pnpm test?', options: [] }
    }
    see(asking)
    see({ ...asking, lastActivityAt: 5 })
    expect(shown.map((n) => [n.kind, n.body])).toEqual([
      ['needs-attention', 'Claude Code on build-box needs you: Allow Bash: pnpm test?']
    ])
  })

  it("leave Seal's own panes to their hooks, and a session first seen waiting unannounced", () => {
    const { shown, see } = watch()
    see({ status: 'waiting-input' })
    see({ id: 'local:claude:s2', inputRoutes: [{ kind: 'seal-pane', paneKey: 'tab-1:0' }] })
    see({
      id: 'local:claude:s2',
      status: 'waiting-input',
      inputRoutes: [{ kind: 'seal-pane', paneKey: 'tab-1:0' }]
    })
    expect(shown).toEqual([])
  })

  it('follow a session to the id its transcript gives it', () => {
    const { shown, see, notifier } = watch()
    see({ id: 'box:claude:pid-4100', status: 'working' })
    notifier.onEvent({
      type: 'remove',
      revision: 99,
      sessionId: 'box:claude:pid-4100',
      replacedBy: 'box:claude:s1'
    })
    see({ status: 'errored', statusDetail: 'API Error: 529 overloaded' })
    expect(shown.map((n) => n.body)).toEqual([
      'Claude Code on build-box hit an error: API Error: 529 overloaded'
    ])
  })
})
