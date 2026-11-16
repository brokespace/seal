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
import { ServerSessionRecaps } from './server-session-recaps'
import type { RecapPassOutcome } from './session-recap-engine'
import { SessionRecapStore } from './session-recap-store'
import {
  recapLiveSession as session,
  recapServerSession,
  recapServerView
} from './session-recap.test-fixture'

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

/** `serverReply` is what a paired server answers every call with; without it no server is reached. */
async function harness(options: { enabled?: boolean; serverReply?: unknown } = {}) {
  const store = new SessionRecapStore(
    join(await mkdtemp(join(tmpdir(), 'seal-live-recaps-')), 'recaps.json')
  )
  const passes: string[] = []
  const timers: { run: () => void; at: number }[] = []
  const clock = { now: 10_000_000 }
  /** What the engine answers, in order; `updated` once these run out. */
  const outcomes: RecapPassOutcome[] = []
  const sessions = new Map<string, LiveSession>()
  const engine: LiveSessionRecapsDeps['engine'] = {
    update: async (sessionId, kind, rebuild, minProseChars) => {
      const prose = minProseChars ? ` ${minProseChars}+` : ''
      passes.push(`${kind}${rebuild ? ' rebuild' : ''}${prose} ${sessionId}`)
      return outcomes.shift() ?? 'updated'
    },
    isUpdating: () => false,
    failure: () => null,
    forget: () => undefined
  }
  const setTimer = (run: () => void, delayMs: number) => {
    const timer = { run, at: clock.now + delayMs }
    timers.push(timer)
    return {
      cancel: () => void (timers.includes(timer) && timers.splice(timers.indexOf(timer), 1))
    }
  }
  const observe = (next: LiveSession) =>
    recaps.observe({ type: 'upsert', revision: 1, session: next })
  const server =
    options.serverReply === undefined
      ? undefined
      : new ServerSessionRecaps({
          call: async () => options.serverReply,
          onChange: () => undefined,
          setTimer,
          now: () => clock.now
        })
  const recaps = new LiveSessionRecaps({
    engine,
    store,
    enabled: () => options.enabled ?? true,
    pausedUntil: () => null,
    session: (sessionId) => sessions.get(sessionId) ?? null,
    readable: (session) => session.transcriptPath !== null,
    server,
    setTimer,
    now: () => clock.now
  })
  const seen = (next: LiveSession) => {
    sessions.set(next.id, next)
    observe(next)
  }
  const stop = (next: LiveSession) => {
    seen(next)
    for (const { run } of timers.splice(0)) {
      run()
    }
  }
  /** Time passes: timers that came due run, and the passes they started finish. */
  const wait = async (ms: number) => {
    clock.now += ms
    for (const timer of timers.filter(({ at }) => at <= clock.now)) {
      timers.splice(timers.indexOf(timer), 1)
      timer.run()
    }
    await new Promise((resolve) => setImmediate(resolve))
  }
  return { recaps, store, passes, stop, seen, wait, outcomes, sessions }
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

  it('recaps a session four minutes into a working turn, and again when it stops', async () => {
    const h = await harness()

    h.seen(session({ status: 'working' }))
    await h.wait(3 * 60_000)
    expect(h.passes).toEqual([])

    await h.wait(60_000)
    expect(h.passes).toEqual(['working 1200+ local:claude:abc'])

    h.stop(session({ status: 'waiting-input', lastActivityAt: 2_000 }))
    expect(h.passes).toEqual(['working 1200+ local:claude:abc', 'auto local:claude:abc'])
  })

  it('takes any new prose once a working session has gone ten minutes without a pass', async () => {
    const h = await harness()
    h.outcomes.push('current')

    h.seen(session({ status: 'working' }))
    await h.wait(4 * 60_000)
    h.seen(session({ status: 'working', lastActivityAt: 2_000 }))
    await h.wait(6 * 60_000)

    expect(h.passes).toEqual(['working 1200+ local:claude:abc', 'working 1+ local:claude:abc'])
  })

  it('does not recap a turn that ends inside four minutes until it stops', async () => {
    const h = await harness()

    h.seen(session({ status: 'working' }))
    await h.wait(2 * 60_000)
    h.seen(session({ status: 'waiting-input', lastActivityAt: 2_000 }))
    await h.wait(5 * 60_000)

    expect(h.passes).toEqual(['auto local:claude:abc'])
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

  it('lists under Not addressed only what the judge found left undone, once the turn is over', async () => {
    const h = await harness()
    const judged = {
      at: 2_000,
      coveredTo: 900,
      model: '@cf/cloudflare/clef',
      questionBook: 'ba879810db9d',
      answers: { done: 0.02, did_part: 0.03, declined: 0.01, withdrawn: 0.01, left_undone: 0.9 },
      leftUndone: true,
      turnEnded: true,
      complete: true
    }
    const item = { messageId: 'o10', at: 1_500 }
    h.store.setRecap(
      'local:claude:abc',
      {
        ...recap(2_000),
        coveredTo: 900,
        // What the read step proposed: it is stored, and never shown.
        ignored: [{ id: 'i9', text: 'Add a retry', ...item }],
        requests: [
          {
            id: 'a4',
            text: 'Write the migration test',
            ...item,
            status: 'open',
            statusAt: 1_500,
            judged
          },
          { id: 'a5', text: 'Update the docs', ...item, status: 'open', statusAt: 1_500 },
          { id: 'a6', text: 'Add a retry', ...item, status: 'addressed', statusAt: 2_000, judged }
        ]
      },
      {}
    )

    const view = h.recaps.view('local:claude:abc', false)
    expect(view.turnEnded).toBe(false)
    expect(view.recap?.ignored).toEqual([])
    h.sessions.set('local:claude:abc', session({ status: 'working' }))
    expect(h.recaps.view('local:claude:abc', false).recap?.ignored).toEqual([])
    expect(h.recaps.decorate(session({ status: 'working' })).recap?.notAddressed).toBeUndefined()

    h.sessions.set('local:claude:abc', session({ status: 'your-turn' }))
    const ended = h.recaps.view('local:claude:abc', false)
    expect(ended.turnEnded).toBe(true)
    expect(ended.recap?.ignored).toEqual([
      { id: 'a4', text: 'Write the migration test', messageId: 'o10', at: 2_000 }
    ])
    expect(h.recaps.decorate(session({ status: 'your-turn' })).recap?.notAddressed).toBe(1)

    // The session moved on after the recap: the verdict is about a conversation that has grown.
    const moved = session({ status: 'your-turn', lastActivityAt: 9_000 })
    h.sessions.set('local:claude:abc', moved)
    expect(h.recaps.view('local:claude:abc', false).recap?.ignored).toEqual([])
    expect(h.recaps.decorate(moved).recap?.notAddressed).toBeUndefined()
  })

  it("makes no recap of a session whose server keeps one, and shows the server's on its row", async () => {
    const h = await harness({ serverReply: recapServerView() })
    const remote = recapServerSession({ status: 'your-turn' })

    h.stop(remote)
    await h.wait(5 * 60_000)

    expect(h.passes).toEqual([])
    expect(h.recaps.decorate(remote).recap).toEqual({
      title: 'Fix login redirect loop',
      rev: 7,
      questions: 1,
      actions: 1,
      notAddressed: 1
    })
  })
})
