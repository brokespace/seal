import { describe, expect, it } from 'vitest'
import type { LiveMessage, LiveTranscriptMessage } from './live-session-schemas'
import { pendingLiveMessages } from './live-session-pending-rows'

const row = (id: string, role: string, text: string, timestamp: number): LiveTranscriptMessage => ({
  id,
  role,
  timestamp,
  blocks: [{ type: 'text', text }]
})

const delivered = (messageId: string, text: string, at: number): LiveMessage => ({
  messageId,
  sessionId: 's',
  text,
  state: 'delivered',
  route: 'tmux',
  error: null,
  createdAt: at,
  updatedAt: at
})

describe('pendingLiveMessages', () => {
  it('drops delivered messages the agent wrote into one transcript row', () => {
    const pending = pendingLiveMessages(
      [row('o1', 'user', 'use pnpm\nok\nok', 0)],
      [
        delivered('a', 'use pnpm', 1),
        delivered('b', 'ok', 2),
        delivered('c', 'ok', 3),
        delivered('d', 'ok', 4)
      ]
    )
    expect(pending.map((message) => message.messageId)).toEqual(['d'])
  })

  it('drops a delivered message once the transcript has moved on past it', () => {
    const scrolledOut = [row('r1', 'assistant', 'done', 2000)]
    expect(pendingLiveMessages(scrolledOut, [delivered('a', 'run the tests', 900)])).toEqual([])
    expect(
      pendingLiveMessages(scrolledOut, [delivered('b', 'and lint', 3000)]).map(
        (message) => message.messageId
      )
    ).toEqual(['b'])
  })
})
