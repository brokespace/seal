import { describe, expect, it } from 'vitest'
import { ServerSessionRecaps } from './server-session-recaps'
import { recapLiveSession, recapServerSession, recapServerView } from './session-recap.test-fixture'

/** A paired server that answers every call with `reply`. */
function harness(reply: unknown) {
  const calls: { server: string; method: string; params: unknown }[] = []
  const recaps = new ServerSessionRecaps({
    call: async (executionHostId, method, params) => {
      calls.push({ server: executionHostId, method, params })
      return reply
    }
  })
  return { recaps, calls }
}

describe('ServerSessionRecaps', () => {
  it('owns every session a paired server runs, and none of this machine', () => {
    const { recaps } = harness(null)

    expect(recaps.owns(recapServerSession())).toBe(true)
    expect(recaps.owns(recapLiveSession())).toBe(false)
  })

  it("answers a client with the server's view, asked for by the id the server knows", async () => {
    const h = harness(recapServerView())

    const view = await h.recaps.mark(recapServerSession(), 'q2', 'dismissed')

    expect(view.sessionId).toBe('machine-1:claude:abc')
    expect(view.recap?.title).toBe('Fix login redirect loop')
    expect(view.recap?.ignored.map((item) => item.text)).toEqual(['Document the flag'])
    expect(h.calls).toEqual([
      {
        server: 'runtime:env-kessel',
        method: 'sessionRecap.mark',
        params: { sessionId: 'local:claude:abc', itemId: 'q2', mark: 'dismissed' }
      }
    ])
  })

  it('passes on that a server makes no recaps: this host makes none in its place', async () => {
    const h = harness(recapServerView({ state: 'unavailable', recap: null }))

    expect((await h.recaps.view(recapServerSession(), true)).state).toBe('unavailable')
  })

  it("passes on the server's reason, and none from a server that gives none", async () => {
    const reason = { kind: 'provider-not-set-up', provider: 'minimax' } as const
    const given = harness(
      recapServerView({ state: 'unavailable', recap: null, unavailableReason: reason })
    )
    const older = harness(recapServerView({ state: 'unavailable', recap: null }))

    expect((await given.recaps.view(recapServerSession(), true)).unavailableReason).toEqual(reason)
    expect((await older.recaps.view(recapServerSession(), true)).unavailableReason).toBeUndefined()
  })

  it('still reads the view of a server that names a reason this host does not know', async () => {
    const h = harness({
      ...recapServerView({ state: 'unavailable', recap: null }),
      unavailableReason: { kind: 'quota-exhausted' }
    })

    const view = await h.recaps.view(recapServerSession(), true)

    expect(view.state).toBe('unavailable')
    expect(view.unavailableReason).toBeUndefined()
  })

  it('calls nothing not addressed on the word of a server from before the judge', async () => {
    const h = harness(recapServerView({ turnEnded: undefined }))

    const view = await h.recaps.view(recapServerSession(), false)

    expect(view.recap?.title).toBe('Fix login redirect loop')
    expect(view.recap?.ignored).toEqual([])
  })

  it('says so when the server does not answer', async () => {
    const h = harness(null)

    const view = await h.recaps.refresh(recapServerSession())

    expect(view).toMatchObject({
      sessionId: 'machine-1:claude:abc',
      recap: null,
      state: 'failed',
      unavailableReason: { kind: 'server-unreachable', message: null }
    })
  })

  it('keeps the message of the call that failed', async () => {
    const recaps = new ServerSessionRecaps({
      call: async () => {
        throw new Error('Request timed out')
      }
    })

    expect((await recaps.view(recapServerSession(), true)).unavailableReason).toEqual({
      kind: 'server-unreachable',
      message: 'Request timed out'
    })
  })
})
