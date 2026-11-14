import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../../shared/native-chat/native-chat-types'
import type { LiveMessage } from '../../../../shared/live-sessions/live-session-types'
import { pendingRows } from './live-session-pending-rows'

const user = (id: string, text: string): NativeChatMessage => ({
  id,
  role: 'user',
  source: 'transcript',
  timestamp: 0,
  blocks: [{ type: 'text', text }]
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
})
