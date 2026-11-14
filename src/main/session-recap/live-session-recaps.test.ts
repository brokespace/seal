import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { LiveSession } from '../../shared/live-sessions/live-session-types'
import {
  emptySessionRecap,
  type SessionRecap
} from '../../shared/session-recap/session-recap-types'
import { LiveSessionRecaps, type LiveSessionRecapsDeps } from './live-session-recaps'
import { SessionRecapStore } from './session-recap-store'

function session(overrides: Partial<LiveSession> = {}): LiveSession {
  return {
    id: 'local:claude:abc',
    provider: 'claude',
    providerSessionId: 'abc',
    machine: { hostId: 'local', label: 'mac', kind: 'local', connection: 'local' },
    origin: 'external',
    cwd: '/repo',
    project: 'repo',
    title: 'fix the login thing',
    status: 'idle',
    statusSource: 'transcript',
    statusDetail: null,
    lastActivityAt: 1_000,
    startedAt: 500,
    alive: true,
    pid: 42,
    transcriptPath: '/t.jsonl',
    inputRoutes: [],
    permission: null,
    ...overrides
  }
}

function recap(updatedAt: number): SessionRecap {
  return {
    ...emptySessionRecap(updatedAt),
    title: 'Fix login redirect loop',
    questions: [
      { id: 'q1', text: 'Drop the audit table?', messageId: 'o10', at: updatedAt },
      { id: 'q2', text: 'Keep the old cookie name?', messageId: 'o30', at: updatedAt }
    ],
    actions: [{ id: 't3', text: 'Set the deploy secret', messageId: 'o20', at: updatedAt }],
    nextItemId: 4
  }
}

async function harness(options: { eager?: boolean; enabled?: boolean } = {}) {
  const store = new SessionRecapStore(
    join(await mkdtemp(join(tmpdir(), 'seal-live-recaps-')), 'recaps.json')
  )
  const passes: string[] = []
  const timers: (() => void)[] = []
  const sessions = new Map<string, LiveSession>()
  const engine: LiveSessionRecapsDeps['engine'] = {
    update: async (sessionId, kind, rebuild) => {
      passes.push(`${kind}${rebuild ? ' rebuild' : ''} ${sessionId}`)
      return 'updated'
    },
    isUpdating: () => false,
    failure: () => null,
    forget: () => undefined
  }
  const recaps = new LiveSessionRecaps({
    engine,
    store,
    enabled: () => options.enabled ?? true,
    pausedUntil: () => null,
    session: (sessionId) => sessions.get(sessionId) ?? null,
    eager: options.eager ?? true,
    setTimer: (run) => {
      timers.push(run)
      return { cancel: () => undefined }
    },
    now: () => 10_000_000
  })
  const stop = (next: LiveSession) => {
    sessions.set(next.id, next)
    recaps.observe({ type: 'upsert', revision: 1, session: next })
    for (const run of timers.splice(0)) {
      run()
    }
  }
  return { recaps, store, passes, stop, sessions }
}

describe('LiveSessionRecaps', () => {
  it('puts the title and the still-open counts on the session row', async () => {
    const h = await harness()
    h.store.setRecap('local:claude:abc', recap(2_000), {})
    h.store.mark('local:claude:abc', 'q1', 'done')
    h.store.mark('local:claude:abc', 't3', 'dismissed')

    expect(h.recaps.decorate(session()).recap).toEqual({
      title: 'Fix login redirect loop',
      rev: 3,
      questions: 1,
      actions: 0
    })
  })

  it('adds nothing to a row while recaps are off', async () => {
    const h = await harness({ enabled: false })
    h.store.setRecap('local:claude:abc', recap(2_000), {})

    expect(h.recaps.decorate(session()).recap).toBeUndefined()
  })

  it('recaps a session when it stops, not while it works', async () => {
    const h = await harness()

    h.stop(session({ status: 'working' }))
    expect(h.passes).toEqual([])

    h.stop(session({ status: 'waiting-input', lastActivityAt: 2_000 }))
    expect(h.passes).toEqual(['auto local:claude:abc'])
  })

  it('on a host that is not eager, waits until someone opens the recap', async () => {
    const h = await harness({ eager: false })

    h.stop(session())
    expect(h.passes).toEqual([])

    h.recaps.view('local:claude:abc', true)
    expect(h.passes).toEqual(['asked local:claude:abc'])
  })

  it('brings a stale recap up to date when it is opened, and only reads it otherwise', async () => {
    const h = await harness()
    h.sessions.set('local:claude:abc', session({ status: 'working', lastActivityAt: 9_000 }))
    h.store.setRecap('local:claude:abc', recap(2_000), {})

    expect(h.recaps.view('local:claude:abc', false).stale).toBe(true)
    expect(h.passes).toEqual([])

    h.recaps.view('local:claude:abc', true)
    expect(h.passes).toEqual(['asked local:claude:abc'])
  })

  it('moves a recap and its ticks to the id a session is resumed under', async () => {
    const h = await harness()
    h.store.setRecap('local:claude:abc', recap(2_000), {})
    h.store.mark('local:claude:abc', 'q1', 'done')

    h.recaps.observe({
      type: 'remove',
      revision: 2,
      sessionId: 'local:claude:abc',
      replacedBy: 'local:claude:def'
    })

    expect(h.recaps.decorate(session({ id: 'local:claude:def' })).recap?.questions).toBe(1)
  })
})
