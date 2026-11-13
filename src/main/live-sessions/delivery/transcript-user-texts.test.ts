import { describe, expect, it } from 'vitest'
import { matchDelivered, userTextsOf } from './transcript-user-texts'

const at = (offset: number, record: unknown) => ({ offset, text: JSON.stringify(record) })

describe('userTextsOf', () => {
  it('reads typed and queued Claude messages but not tool results', () => {
    expect(
      userTextsOf('claude', [
        at(0, { type: 'user', message: { role: 'user', content: 'run   the\ntests' } }),
        at(40, {
          type: 'user',
          message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] }
        }),
        at(90, { type: 'attachment', attachment: { type: 'queued_command', prompt: 'then lint' } })
      ])
    ).toEqual([
      { offset: 0, text: 'run the tests' },
      { offset: 90, text: 'then lint' }
    ])
  })

  it('counts a Codex prompt once even though the rollout echoes it', () => {
    expect(
      userTextsOf('codex', [
        at(0, { type: 'event_msg', payload: { type: 'user_message', message: 'ship it' } }),
        at(50, {
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'ship it' }]
          }
        })
      ])
    ).toEqual([{ offset: 0, text: 'ship it' }])
  })

  it('reads the item_completed user turns newer Codex writes instead of user_message', () => {
    expect(
      userTextsOf('codex', [
        at(0, {
          type: 'event_msg',
          payload: {
            type: 'item_completed',
            item: { type: 'UserMessage', content: [{ type: 'text', text: 'queued from Seal' }] }
          }
        }),
        at(90, {
          type: 'event_msg',
          payload: { type: 'item_completed', item: { type: 'AgentMessage', content: [] } }
        })
      ])
    ).toEqual([{ offset: 0, text: 'queued from Seal' }])
  })
})

describe('matchDelivered', () => {
  it('matches repeats one record each, joined queued messages together, and whole words only', () => {
    const a = { text: 'ok', offset: 10 }
    const b = { text: 'ok', offset: 10 }
    const c = { text: 'then lint', offset: 10 }
    const early = { text: 'look', offset: 500 }
    const delivered = matchDelivered(
      [a, b, c, early],
      [
        { offset: 5, text: 'look' },
        { offset: 20, text: 'ok' },
        { offset: 60, text: 'ok then lint' }
      ]
    )
    expect([a, b, c, early].map((m) => delivered.has(m))).toEqual([true, true, true, false])
    expect(matchDelivered([{ text: 'ok', offset: 0 }], [{ offset: 0, text: 'look' }]).size).toBe(0)
  })
})
