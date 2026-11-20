import { describe, expect, it } from 'vitest'
import { sampleSessionSurface } from '../../../shared/live-sessions/live-session-surface.test-fixture'
import type { LiveSession } from '../../../shared/live-sessions/live-session-types'
import { createHomeChatSessionAccess, type HomeChatLiveSessions } from './home-chat-session-access'

function session(id: string, patch: Partial<LiveSession>): LiveSession {
  return {
    id,
    provider: 'claude',
    providerSessionId: id,
    machine: { hostId: 'local', label: 'laptop', kind: 'local' },
    origin: 'external',
    ...sampleSessionSurface(),
    cwd: '/code/shop',
    project: 'shop',
    title: id,
    status: 'working',
    statusSource: 'transcript',
    statusDetail: null,
    lastActivityAt: 1,
    startedAt: 0,
    alive: true,
    pid: 1,
    transcriptPath: null,
    inputRoutes: [],
    permission: null,
    ...patch
  }
}

function accessOver(sessions: LiveSession[]): ReturnType<typeof createHomeChatSessionAccess> {
  const live: HomeChatLiveSessions = {
    registry: { currentId: (id) => id },
    snapshot: () => ({ revision: 1, sessions, hostErrors: {} }),
    refresh: () => Promise.resolve(),
    transcriptPage: () => Promise.reject(new Error('unused')),
    send: () => Promise.reject(new Error('unused')),
    messages: () => []
  }
  return createHomeChatSessionAccess({ live: () => live })
}

describe('createHomeChatSessionAccess', () => {
  it('lists chats, panes of any agent and external sessions with where each runs', async () => {
    const { sessions } = await accessOver([
      session('chat', {
        origin: 'seal',
        ...sampleSessionSurface('seal'),
        surface: { kind: 'chat', sessionId: 'c1', tabId: 't1' },
        // A chat between turns: no agent process, and it still takes the next message.
        alive: false,
        status: 'your-turn',
        lastActivityAt: 3,
        workspace: { worktreeId: 'shop::/code/shop', projectKey: 'github:acme/shop' }
      }),
      session('pane', {
        provider: 'grok',
        origin: 'seal',
        ...sampleSessionSurface('seal'),
        lastActivityAt: 2
      }),
      session('outside', { alive: false, status: 'done' })
    ]).list()

    expect(
      sessions.map(({ id, agent, surface, active, canTakeOver, place, worktreeId }) => ({
        id,
        agent,
        surface,
        active,
        canTakeOver,
        project: [place.projectKey, place.project],
        worktreeId
      }))
    ).toEqual([
      {
        id: 'chat',
        agent: 'claude',
        surface: 'chat',
        active: true,
        canTakeOver: false,
        project: ['github:acme/shop', 'shop'],
        worktreeId: 'shop::/code/shop'
      },
      {
        id: 'pane',
        agent: 'grok',
        surface: 'cli',
        active: true,
        canTakeOver: false,
        project: ['folder:shop', 'shop'],
        worktreeId: null
      },
      {
        id: 'outside',
        agent: 'claude',
        surface: 'external',
        active: false,
        canTakeOver: true,
        project: ['folder:shop', 'shop'],
        worktreeId: null
      }
    ])
  })
})
