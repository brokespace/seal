import { describe, expect, it } from 'vitest'
import { ServerSessionRecaps } from './server-session-recaps'
import { recapServerSession, recapServerView } from './session-recap.test-fixture'

type Call = { server: string; method: string; params: unknown }

/** A paired server that answers every call with `reply`, or with whatever it is set to later. */
function harness(reply: unknown) {
  const server = { reply }
  const calls: Call[] = []
  const clock = { now: 10_000_000 }
  const recaps = new ServerSessionRecaps({
    call: async (executionHostId, method, params) => {
      calls.push({ server: executionHostId, method, params })
      return server.reply
    },
    onChange: () => undefined,
    setTimer: () => ({ cancel: () => undefined }),
    now: () => clock.now
  })
  const answered = () => new Promise((resolve) => setImmediate(resolve))
  return { recaps, calls, clock, server, answered }
}

describe('ServerSessionRecaps', () => {
  it('shows the recap a server keeps, under the id this host gives the session', async () => {
    const h = harness(recapServerView())
    const session = recapServerSession()

    h.recaps.observe(session)
    await h.answered()

    expect(h.recaps.owns(session)).toBe(true)
    expect(h.recaps.brief(session)).toEqual({
      title: 'Fix login redirect loop',
      rev: 7,
      questions: 1,
      actions: 1,
      notAddressed: 1
    })
  })

  it('keeps the sessions of a server that makes no recaps: this host makes none in its place', async () => {
    const h = harness(recapServerView({ state: 'unavailable', recap: null }))
    const session = recapServerSession()

    h.recaps.observe(session)
    await h.answered()

    expect(h.recaps.owns(session)).toBe(true)
    expect(h.recaps.brief(session)).toBeNull()
    expect((await h.recaps.view(session, true)).state).toBe('unavailable')
  })

  it('calls nothing not addressed on the word of a server from before the judge', async () => {
    const h = harness(recapServerView({ turnEnded: undefined }))
    const session = recapServerSession()

    h.recaps.observe(session)
    await h.answered()

    expect(h.recaps.brief(session)).toEqual({
      title: 'Fix login redirect loop',
      rev: 7,
      questions: 1,
      actions: 1
    })
    expect((await h.recaps.view(session, false)).recap?.ignored).toEqual([])
  })

  it('asks the server about the session by the id the server knows it by', async () => {
    const h = harness(recapServerView())

    h.recaps.observe(recapServerSession())
    await h.answered()

    expect(h.calls).toEqual([
      {
        server: 'runtime:env-kessel',
        method: 'sessionRecap.get',
        params: { sessionId: 'local:claude:abc', look: false }
      }
    ])
  })

  it("answers a client with the server's view under this host's session id", async () => {
    const h = harness(recapServerView())

    const view = await h.recaps.mark(recapServerSession(), 'q2', 'dismissed')

    expect(view.sessionId).toBe('machine-1:claude:abc')
    expect(view.recap?.title).toBe('Fix login redirect loop')
    expect(h.calls).toEqual([
      {
        server: 'runtime:env-kessel',
        method: 'sessionRecap.mark',
        params: { sessionId: 'local:claude:abc', itemId: 'q2', mark: 'dismissed' }
      }
    ])
  })

  it('keeps a server its recaps when one of its answers goes missing', async () => {
    const h = harness(recapServerView())
    const session = recapServerSession()
    h.recaps.observe(session)
    await h.answered()
    h.server.reply = null

    const view = await h.recaps.view(session, true)

    expect(view.state).toBe('failed')
    expect(h.recaps.owns(session)).toBe(true)
    expect(h.recaps.brief(session)?.rev).toBe(7)
  })
})
