import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../../shared/native-chat/native-chat-types'
import type { LiveMessage } from '../../../../shared/live-sessions/live-session-types'
import { pendingRows } from './live-session-pending-rows'

const user = (id: string, text: string, timestamp = 0): NativeChatMessage => ({
  id,
  role: 'user',
  source: 'transcript',
  timestamp,
  blocks: [{ type: 'text', text }]
})

const reply = (id: string, timestamp: number): NativeChatMessage => ({
  id,
  role: 'assistant',
  source: 'transcript',
  timestamp,
  blocks: [{ type: 'text', text: 'done' }]
})

const message = (
  messageId: string,
  text: string,
  state: LiveMessage['state'],
  createdAt: number
): LiveMessage => ({
  messageId,
  sessionId: 's',
  text,
  state,
  route: 'tmux',
  error: null,
  createdAt,
  updatedAt: createdAt
})

describe('pendingRows', () => {
  it('keeps undelivered messages in send order and drops delivered ones the transcript shows, once each', () => {
    const rows = pendingRows(
      [user('o1', 'ok'), user('o9', 'run  the\ntests')],
      [
        message('c', 'still typing', 'sending', 3),
        message('a', 'run the tests', 'delivered', 1),
        message('b', 'ok', 'delivered', 2),
        message('d', 'ok', 'delivered', 4)
      ]
    )
    expect(rows.map((r) => [r.message.messageId, r.row.id])).toEqual([
      ['c', 'live-message:c'],
      ['d', 'live-message:d']
    ])
  })

  it('drops delivered messages the agent wrote into one transcript row', () => {
    const rows = pendingRows(
      [user('o1', 'use pnpm\nok\nok')],
      [
        message('a', 'use pnpm', 'delivered', 1),
        message('b', 'ok', 'delivered', 2),
        message('c', 'ok', 'delivered', 3),
        message('d', 'ok', 'delivered', 4)
      ]
    )
    expect(rows.map((r) => r.message.messageId)).toEqual(['d'])
  })

  it('drops a delivered message once the transcript has moved on past it', () => {
    const transcript = [user('o1', 'run the tests', 1000)]
    for (let i = 0; i < 60; i++) {
      transcript.push(reply(`r${i}`, 2000 + i))
    }
    const scrolledOut = transcript.slice(1)
    const sent = [message('a', 'run the tests', 'delivered', 900)]
    expect(pendingRows(transcript, sent)).toEqual([])
    expect(pendingRows(scrolledOut, sent)).toEqual([])
    expect(
      pendingRows(scrolledOut, [message('b', 'and lint', 'delivered', 3000)]).map(
        (r) => r.message.messageId
      )
    ).toEqual(['b'])
  })
})
