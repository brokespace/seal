import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../../shared/native-chat/native-chat-types'
import { orderNativeChatDisplayMessages } from '../../../../shared/native-chat/transcript/native-chat-message-order'
import type { LiveMessage } from '../../../../shared/live-sessions/live-session-types'
import { pendingRows } from './live-session-pending-rows'

const row = (offset: number, role: NativeChatMessage['role'], text: string): NativeChatMessage => ({
  id: `o${offset}`,
  role,
  source: 'transcript',
  timestamp: offset,
  transcriptOffset: offset,
  transcriptOrder: offset,
  blocks: [{ type: 'text', text }]
})

const message = (
  messageId: string,
  state: LiveMessage['state'],
  at: number,
  place: Pick<LiveMessage, 'sentOffset' | 'echoOffset'> = {}
): LiveMessage => ({
  messageId,
  sessionId: 's',
  text: messageId,
  state,
  route: 'tmux',
  error: null,
  createdAt: at,
  updatedAt: at,
  ...place
})

/** The ids in the order the chat draws them. */
function drawn(transcript: NativeChatMessage[], readTo: number, messages: LiveMessage[]): string[] {
  const pending = pendingRows(transcript, readTo, messages)
  return orderNativeChatDisplayMessages([...transcript, ...pending.map((p) => p.row)]).map(
    (m) => m.id
  )
}

describe('pendingRows', () => {
  it('draws a pending message where it was written, above what the agent wrote since', () => {
    const transcript = [
      row(100, 'user', 'start'),
      row(200, 'assistant', 'on it'),
      row(400, 'assistant', 'tool turn'),
      row(500, 'assistant', 'the newest reply')
    ]
    expect(
      drawn(transcript, 600, [
        message('typed mid-turn', 'sent', 9_000, { sentOffset: 300 }),
        message('typed after it', 'queued', 9_001, { sentOffset: 300 }),
        message('typed now', 'sending', 9_002, { sentOffset: 600 }),
        message('never placed', 'queued', 9_003)
      ])
    ).toEqual([
      'o100',
      'o200',
      'live-message:typed mid-turn',
      'live-message:typed after it',
      'o400',
      'o500',
      'live-message:typed now',
      'live-message:never placed'
    ])
  })

  it('draws nothing for delivered messages the transcript holds, however far back', () => {
    const transcript = [row(8_000, 'assistant', 'tool turn'), row(8_100, 'assistant', 'reply')]
    expect(
      drawn(transcript, 8_200, [
        message('first', 'delivered', 50_000, { sentOffset: 100, echoOffset: 100 }),
        message('second', 'delivered', 50_001, { sentOffset: 300, echoOffset: 4_000 })
      ])
    ).toEqual(['o8000', 'o8100'])
  })
})
