import { describe, expect, it } from 'vitest'
import { lastContent, recapHarness, recapMessage } from './session-recap.test-fixture'

const FIRST_REPLY = JSON.stringify({
  title: 'Dark mode toggle',
  goal: 'Let people switch the app to a dark theme.',
  standing: 'The toggle exists; its default is undecided.',
  add: {
    asked: [{ text: 'Add a dark mode toggle', ref: 'm1' }],
    did: [{ text: 'Added the toggle to settings', state: 'done', ref: 'm2' }],
    questions: [{ text: 'Which default should it use?', ref: 'm2' }]
  }
})

function firstTurn() {
  return [
    recapMessage(0, 'user', 'Add a dark mode toggle, with a switch in the header too'),
    recapMessage(100, 'assistant', 'Added the toggle to settings. Which default should it use?')
  ]
}

describe('SessionRecapEngine', () => {
  it('reads the transcript once, then sends only what was said since with the recap carried forward', async () => {
    const messages = firstTurn()
    const h = await recapHarness(messages, [
      FIRST_REPLY,
      JSON.stringify({
        standing: 'Defaults to the system theme.',
        add: { asked: [{ text: 'Default to the system theme', ref: 'm1' }] },
        update: [{ id: 'w2', text: 'Added the toggle, defaulting to system' }],
        resolve: ['q3']
      })
    ])

    expect(await h.engine.update('s1', 'asked')).toBe('updated')
    const first = h.store.get('s1')?.recap
    expect(first?.title).toBe('Dark mode toggle')
    expect(first?.asked).toEqual([
      { id: 'a1', text: 'Add a dark mode toggle', messageId: 'o0', at: 50_000 }
    ])
    expect(first?.questions).toEqual([
      { id: 'q3', text: 'Which default should it use?', messageId: 'o100', at: 50_000 }
    ])
    expect(first?.coveredTo).toBe(200)

    messages.push(
      recapMessage(200, 'user', 'Default to the system theme'),
      recapMessage(300, 'assistant', 'Done, it follows the system theme now.')
    )
    h.clock.now = 60_000
    expect(await h.engine.update('s1', 'auto')).toBe('updated')

    const second = lastContent(h.requests[1])
    expect(second).toContain('[m1] USER: Default to the system theme')
    expect(second).toContain('"id":"q3"')
    expect(second).not.toContain('switch in the header')
    const recap = h.store.get('s1')?.recap
    expect(recap?.questions).toEqual([])
    expect(recap?.asked.map((item) => [item.id, item.messageId])).toEqual([
      ['a1', 'o0'],
      ['a4', 'o200']
    ])
    expect(recap?.did).toEqual([
      {
        id: 'w2',
        text: 'Added the toggle, defaulting to system',
        messageId: 'o100',
        at: 50_000,
        state: 'done'
      }
    ])
    expect(recap?.coveredTo).toBe(400)
  })

  it('asks no model when nothing was said since the last pass', async () => {
    const h = await recapHarness(firstTurn(), [FIRST_REPLY])
    await h.engine.update('s1', 'asked')

    expect(await h.engine.update('s1', 'auto')).toBe('current')
    expect(h.requests).toHaveLength(1)
  })

  it('asks again once when the reply is not JSON, then keeps what it can read without the model', async () => {
    const h = await recapHarness(firstTurn(), ['Sure! Here is your recap.', 'Still not JSON'])

    expect(await h.engine.update('s1', 'asked')).toBe('updated')

    expect(h.requests).toHaveLength(2)
    expect(h.requests[1].messages.at(-2)).toEqual({
      role: 'assistant',
      content: 'Sure! Here is your recap.'
    })
    const recap = h.store.get('s1')?.recap
    expect(recap?.degraded).toBe(true)
    expect(recap?.asked).toEqual([
      {
        id: 'a1',
        text: 'Add a dark mode toggle, with a switch in the header too',
        messageId: 'o0',
        at: 50_000
      }
    ])
    expect(recap?.coveredTo).toBe(200)
  })

  it('uses a repaired reply and does not mark the recap degraded', async () => {
    const h = await recapHarness(firstTurn(), ['not json', FIRST_REPLY])

    await h.engine.update('s1', 'asked')

    const recap = h.store.get('s1')?.recap
    expect(recap?.title).toBe('Dark mode toggle')
    expect(recap?.degraded).toBeUndefined()
  })

  it('leaves the recap where it was when the provider fails', async () => {
    const messages = firstTurn()
    const h = await recapHarness(messages, [FIRST_REPLY, new Error('Could not reach Cloudflare')])
    await h.engine.update('s1', 'asked')
    messages.push(recapMessage(200, 'user', 'Default to the system theme'))

    expect(await h.engine.update('s1', 'auto')).toBe('failed')

    expect(h.engine.failure('s1')).toBe('Could not reach Cloudflare')
    expect(h.store.get('s1')?.recap?.coveredTo).toBe(200)
  })

  it("stops automatic passes at the day's share and still runs one the user asked for", async () => {
    const h = await recapHarness(firstTurn(), [FIRST_REPLY])
    h.budget.spend(6_000)

    expect(await h.engine.update('s1', 'auto')).toBe('over-budget')
    expect(h.requests).toHaveLength(0)

    expect(await h.engine.update('s1', 'asked')).toBe('updated')
  })

  it('keeps a tick through later passes and carries it by text into a rebuilt recap', async () => {
    const messages = firstTurn()
    const h = await recapHarness(messages, [
      FIRST_REPLY,
      JSON.stringify({ add: { asked: [{ text: 'Use the accent colour', ref: 'm1' }] } }),
      FIRST_REPLY
    ])
    await h.engine.update('s1', 'asked')
    h.store.mark('s1', 'q3', 'done')

    messages.push(recapMessage(200, 'user', 'Use the accent colour for the switch'))
    await h.engine.update('s1', 'auto')
    expect(h.store.get('s1')?.marks).toEqual({ q3: 'done' })

    await h.engine.update('s1', 'asked', true)
    const rebuilt = h.store.get('s1')
    expect(rebuilt?.recap?.questions.map((item) => item.id)).toEqual(['q7'])
    expect(rebuilt?.marks).toEqual({ q7: 'done' })
  })
})
