import { describe, expect, it } from 'vitest'
import type { LiveSession } from '../../../shared/live-sessions/live-session-types'
import { sampleSessionSurface } from '../../../shared/live-sessions/live-session-surface.test-fixture'
import { mergeSessionSources } from './session-source-merge'
import { sessionSuccessor } from './session-succession'

const LOCAL = { hostId: 'local', label: 'desk', kind: 'local' } as const

function session(providerSessionId: string, patch: Partial<LiveSession> = {}): LiveSession {
  return {
    id: `local:claude:${providerSessionId}`,
    provider: 'claude',
    providerSessionId,
    machine: LOCAL,
    origin: 'external',
    ...sampleSessionSurface(),
    cwd: null,
    project: null,
    title: null,
    status: 'idle',
    statusSource: 'transcript',
    statusDetail: null,
    lastActivityAt: 1_000,
    startedAt: null,
    alive: true,
    pid: null,
    transcriptPath: null,
    inputRoutes: [],
    permission: null,
    ...patch
  }
}

function chat(providerSessionId: string, patch: Partial<LiveSession> = {}): LiveSession {
  return session(providerSessionId, {
    origin: 'seal',
    surface: { kind: 'chat', sessionId: 'chat-1', tabId: 'tab-1' },
    statusSource: 'seal-hooks',
    inputRoutes: [{ kind: 'structured', sessionId: 'chat-1' }],
    ...patch
  })
}

const READING = {
  usedTokens: 44_500,
  windowTokens: 200_000,
  percentage: 22,
  estimated: true,
  rows: [],
  model: 'claude-sonnet-4-5'
}

const merge = (discovered: LiveSession[], chats: LiveSession[]): LiveSession[] =>
  mergeSessionSources({ discovered, panes: [], chats, localMachine: LOCAL })

describe('one record per session across sources', () => {
  it('lets the chat own a session the scan also found, and fills what the chat does not know', () => {
    const scanned = session('abc', {
      status: 'idle',
      cwd: '/srv/shop',
      title: 'Fix checkout',
      pid: 4100,
      transcriptPath: '/home/u/.claude/projects/shop/abc.jsonl',
      lastActivityAt: 5_000,
      inputRoutes: [{ kind: 'resume' }],
      context: READING,
      model: 'claude-sonnet-4-5'
    })
    const owned = chat('abc', { status: 'needs-permission', cwd: '/srv/shop-chat' })

    expect(merge([scanned], [owned])).toEqual([
      {
        ...owned,
        cwd: '/srv/shop-chat',
        title: 'Fix checkout',
        pid: 4100,
        transcriptPath: '/home/u/.claude/projects/shop/abc.jsonl',
        lastActivityAt: 5_000,
        context: READING,
        model: 'claude-sonnet-4-5'
      }
    ])
  })

  it('lists a chat the scan never saw', () => {
    const scanned = session('other')
    const owned = chat('seal-chat-1')
    expect(merge([scanned], [owned]).map((s) => s.id)).toEqual([
      'local:claude:other',
      'local:claude:seal-chat-1'
    ])
  })

  it('drops the closed transcript a chat adopted, and keeps one that is still running', () => {
    const owned = chat('new', { continues: ['local:claude:old', 'local:claude:busy'] })
    const closed = session('old', { alive: false })
    const running = session('busy', { alive: true })
    expect(merge([closed, running], [owned]).map((s) => s.id)).toEqual([
      'local:claude:busy',
      'local:claude:new'
    ])
  })
})

describe('the record a session that left the list lives on in', () => {
  const cli = (providerSessionId: string, paneKey: string): LiveSession =>
    session(providerSessionId, { origin: 'seal', surface: { kind: 'cli', paneKey } })

  const cases: { name: string; gone: LiveSession; now: LiveSession[]; successor: string | null }[] =
    [
      {
        name: 'a fork or a resume that continues it',
        gone: session('abc'),
        now: [session('other'), session('fork', { continues: ['local:claude:abc'] })],
        successor: 'local:claude:fork'
      },
      {
        name: 'the same process once its agent named the session',
        gone: session('pid-4100', { pid: 4100 }),
        now: [session('abc', { pid: 4100 })],
        successor: 'local:claude:abc'
      },
      {
        name: 'the same chat once its provider minted an id',
        gone: chat('seal-chat-1'),
        now: [chat('abc')],
        successor: 'local:claude:abc'
      },
      {
        name: 'another chat is not the same conversation',
        gone: chat('seal-chat-1'),
        now: [chat('abc', { surface: { kind: 'chat', sessionId: 'chat-2', tabId: 'tab-2' } })],
        successor: null
      },
      {
        name: 'the same pane once its hooks reported an id',
        gone: cli('pane-tab-1:0', 'tab-1:0'),
        now: [cli('abc', 'tab-1:0')],
        successor: 'local:claude:abc'
      },
      {
        name: 'a named session whose pane started a new one is not replaced',
        gone: cli('abc', 'tab-1:0'),
        now: [cli('def', 'tab-1:0')],
        successor: null
      },
      {
        name: 'another agent on the same pid is not the same session',
        gone: session('pid-4100', { pid: 4100 }),
        now: [session('abc', { pid: 4100, provider: 'codex', id: 'local:codex:abc' })],
        successor: null
      }
    ]

  it.each(cases)('$name', ({ gone, now, successor }) => {
    expect(sessionSuccessor(gone, now)?.id ?? null).toBe(successor)
  })
})
