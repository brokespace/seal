import { expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../../../shared/native-chat/native-chat-types'
import { externalAgentSessionChatRows } from './external-agent-session-chat-rows'

const user = (id: string, text: string): NativeChatMessage => ({
  id,
  role: 'user',
  blocks: [{ type: 'text', text }],
  timestamp: 1_799_999_400_000,
  source: 'transcript'
})

it("shows a pasted image's recorded path as the image of the prompt it was pasted into", () => {
  const rows = externalAgentSessionChatRows({
    agent: 'claude',
    providerSessionId: 'abc',
    transcript: {
      messages: [
        user('o0', '[Image: source: /home/brian/.claude/image-cache/abc/1.png]'),
        user('o210', '[Image #1] What is wrong with this layout?')
      ],
      phase: 'ready',
      error: null,
      readTo: 400,
      hasMore: false,
      loadingEarlier: false,
      loadEarlier: async () => 'exhausted' as const
    },
    pending: [],
    working: false
  })

  expect(rows.messages.map(({ id, blocks }) => ({ id, blocks }))).toEqual([
    {
      id: 'o210',
      blocks: [
        { type: 'image-ref', path: '/home/brian/.claude/image-cache/abc/1.png' },
        { type: 'text', text: 'What is wrong with this layout?' }
      ]
    }
  ])
})
