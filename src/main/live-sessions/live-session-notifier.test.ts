import { describe, expect, it } from 'vitest'
import type { LiveSession } from '../../shared/live-sessions/live-session-types'
import {
  isLiveSessionNoticeEnabled,
  LiveSessionNotifier,
  liveSessionNotificationOwner,
  type LiveSessionNotification
} from './live-session-notifier'

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
    see({ status: 'your-turn', lastMessage: 'Both reviews are in; nothing blocking.' })
    expect(shown).toEqual([
      {
        sessionId: 'box:claude:s1',
        kind: 'finished',
        title: 'Fix the coupon bug',
        body: 'Claude Code on build-box finished: Both reviews are in; nothing blocking.'
      }
    ])
  })

  it('announce a finished turn once when its reply is then read as a question', () => {
    const { shown, see } = watch()
    see({ status: 'working' })
    see({ status: 'your-turn', lastMessage: 'Should I go ahead with staging' })
    see({ status: 'waiting-input', statusSource: 'classifier' })
    expect(shown.map((n) => n.kind)).toEqual(['finished'])
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

  it('leave a session first seen waiting unannounced', () => {
    const { shown, see } = watch()
    see({ status: 'waiting-input' })
    expect(shown).toEqual([])
  })

  it('come from the owner of the surface a session runs on, and only once', () => {
    const sessions: (Partial<LiveSession> & { id: string })[] = [
      { id: 'chat', surface: { kind: 'chat', sessionId: 'c1', tabId: 'tab-c1' } },
      { id: 'cli', surface: { kind: 'cli', paneKey: 'tab-1:0' } },
      { id: 'pane-route', inputRoutes: [{ kind: 'seal-pane', paneKey: 'tab-2:0' }] },
      { id: 'chat-route', inputRoutes: [{ kind: 'structured', sessionId: 'c2' }] },
      { id: 'outside', inputRoutes: [{ kind: 'tmux', target: '%3' }] }
    ]
    expect(
      sessions.map((session) => [session.id, liveSessionNotificationOwner({ ...base, ...session })])
    ).toEqual([
      ['chat', 'structured-attention'],
      ['cli', 'agent-hooks'],
      ['pane-route', 'agent-hooks'],
      ['chat-route', 'structured-attention'],
      ['outside', 'live-session-notifier']
    ])

    const { shown, see } = watch()
    for (const session of sessions) {
      see({ ...session, status: 'working' })
      see({ ...session, status: 'needs-permission' })
    }
    expect(shown.map((n) => n.sessionId)).toEqual(['outside'])
  })

  it("name the agent by its adapter's label, and ask whether that kind of notice is wanted", () => {
    const asked: string[] = []
    const shown: LiveSessionNotification[] = []
    const notifier = new LiveSessionNotifier({
      wanted: (kind) => {
        asked.push(kind)
        return kind === 'finished'
      },
      show: (n) => shown.push(n)
    })
    const copilot = { ...base, provider: 'copilot' as const, title: null }
    const steps: Partial<LiveSession>[] = [
      { status: 'working' },
      { status: 'waiting-input' },
      { status: 'working' },
      { status: 'your-turn' }
    ]
    steps.forEach((step, index) =>
      notifier.onEvent({ type: 'upsert', revision: index, session: { ...copilot, ...step } })
    )
    expect(asked).toEqual(['needs-attention', 'finished'])
    expect(shown.map((n) => n.body)).toEqual(['GitHub Copilot on build-box finished'])
  })

  it('follow "Agent needs input" and "Agent task complete", each on its own', () => {
    const on = { enabled: true, agentNeedsInput: true, agentTaskComplete: true, terminalBell: true }
    const verdicts = (settings: typeof on) => [
      isLiveSessionNoticeEnabled(settings, 'needs-attention'),
      isLiveSessionNoticeEnabled(settings, 'finished')
    ]
    expect(verdicts(on)).toEqual([true, true])
    expect(verdicts({ ...on, agentNeedsInput: false })).toEqual([false, true])
    expect(verdicts({ ...on, agentTaskComplete: false })).toEqual([true, false])
    expect(verdicts({ ...on, enabled: false })).toEqual([false, false])
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
