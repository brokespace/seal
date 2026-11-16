import { describe, expect, it } from 'vitest'
import type {
  LiveSession,
  LiveSessionRegistryEvent
} from '../../../../shared/live-sessions/live-session-types'
import { sampleSessionSurface } from '../../../../shared/live-sessions/live-session-surface.test-fixture'
import { installLiveSessionNotifier } from '../../../live-sessions/live-session-notifier'
import { createExternalSessionPhonePush } from './external-session-phone-push'
import type { MobileNotificationDispatchEvent } from './runtime-mobile-notification-controller'

const NOW = 1_700_000_000_000

const outside: LiveSession = {
  id: 'local:claude:s1',
  provider: 'claude',
  providerSessionId: 's1',
  machine: { hostId: 'local', label: 'laptop', kind: 'local', connection: 'local' },
  origin: 'external',
  ...sampleSessionSurface(),
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

const asking: Partial<LiveSession> = {
  status: 'needs-permission',
  permission: { promptId: 'p1', question: 'Allow Bash: pnpm test?', options: [] }
}

const allOn = { enabled: true, agentNeedsInput: true, agentTaskComplete: true, terminalBell: true }

/** A host's registry notifier with the phone as its only channel, as the headless server runs it. */
function host(settings: { liveSessionsNotify?: boolean; notifications: typeof allOn }) {
  const pushed: MobileNotificationDispatchEvent[] = []
  const listed = new Map<string, LiveSession>()
  let publish: (event: LiveSessionRegistryEvent) => void = () => {}
  installLiveSessionNotifier(
    { subscribe: (listener) => (publish = listener) },
    { getSettings: () => settings },
    createExternalSessionPhonePush(
      { dispatchMobileNotification: (event) => pushed.push(event) },
      { get: (sessionId) => listed.get(sessionId) ?? null },
      () => NOW
    )
  )
  let revision = 0
  const see = (session: LiveSession) => {
    listed.set(session.id, session)
    publish({ type: 'upsert', revision: ++revision, session })
  }
  return { pushed, see }
}

describe('phone push for sessions outside Seal', () => {
  it('pushes once when the session asks, and once when its turn ends', () => {
    const { pushed, see } = host({ notifications: allOn })
    see(outside)
    see({ ...outside, ...asking })
    see({ ...outside, ...asking, lastActivityAt: 5 })
    expect(pushed).toEqual([
      {
        type: 'notification',
        emittedAt: 1_700_000_000_000,
        source: 'agent-task-complete',
        title: 'Fix the coupon bug',
        body: 'Claude Code on laptop needs you: Allow Bash: pnpm test?',
        agentState: 'waiting',
        attentionKey: 'live-session:local:claude:s1:needs-attention'
      }
    ])

    const linked = { ...outside, workspace: { worktreeId: 'repo-1::/srv/shop', projectKey: 'p' } }
    see(linked)
    see({ ...linked, status: 'your-turn', lastMessage: 'Tests pass.' })
    expect(pushed.slice(1)).toEqual([
      {
        type: 'notification',
        emittedAt: 1_700_000_000_000,
        source: 'agent-task-complete',
        title: 'Fix the coupon bug',
        body: 'Claude Code on laptop finished: Tests pass.',
        worktreeId: 'repo-1::/srv/shop',
        agentState: 'done',
        attentionKey: 'live-session:local:claude:s1:finished'
      }
    ])
  })

  it('leaves chats and panes to their owners, and a paired server’s session to that server', () => {
    const { pushed, see } = host({ notifications: allOn })
    const others: LiveSession[] = [
      { ...outside, id: 'chat', surface: { kind: 'chat', sessionId: 'c1', tabId: 'tab-c1' } },
      { ...outside, id: 'cli', surface: { kind: 'cli', paneKey: 'tab-1:0' } }
    ]
    for (const session of others) {
      see(session)
      see({ ...session, status: 'your-turn' })
      // The one notice the registry notifier raises for a surface it does not own.
      see({ ...session, status: 'waiting-input', statusSource: 'classifier' })
    }
    const onServer: LiveSession = {
      ...outside,
      id: 'box:claude:s1',
      machine: { hostId: 'box', label: 'build-box', kind: 'remote', connection: 'server' }
    }
    see(onServer)
    see({ ...onServer, ...asking })
    expect(pushed).toEqual([])
  })

  it('follows "Agent needs input", "Agent task complete" and the switch for outside sessions', () => {
    const quietAsks = host({ notifications: { ...allOn, agentNeedsInput: false } })
    quietAsks.see(outside)
    quietAsks.see({ ...outside, ...asking })
    quietAsks.see(outside)
    quietAsks.see({ ...outside, status: 'your-turn' })
    expect(quietAsks.pushed.map((event) => event.agentState)).toEqual(['done'])

    const quietEnds = host({ notifications: { ...allOn, agentTaskComplete: false } })
    quietEnds.see(outside)
    quietEnds.see({ ...outside, status: 'your-turn' })
    quietEnds.see(outside)
    quietEnds.see({ ...outside, ...asking })
    expect(quietEnds.pushed.map((event) => event.agentState)).toEqual(['waiting'])

    const muted = host({ liveSessionsNotify: false, notifications: allOn })
    muted.see(outside)
    muted.see({ ...outside, ...asking })
    expect(muted.pushed).toEqual([])
  })
})
