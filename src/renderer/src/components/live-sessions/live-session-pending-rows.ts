import type { NativeChatMessage } from '../../../../shared/native-chat/native-chat-types'
import type { LiveMessage } from '../../../../shared/live-sessions/live-session-types'

const words = (text: string) => text.split(/\s+/).filter(Boolean).join(' ')

function userText(message: NativeChatMessage): string {
  return words(message.blocks.map((block) => (block.type === 'text' ? block.text : '')).join('\n'))
}

export type PendingRow = { row: NativeChatMessage; message: LiveMessage }

/**
 * Outbox messages the transcript doesn't show yet, as user rows after it. A delivered message
 * stays until its transcript row arrives (the transcript is read a moment after delivery is seen).
 */
export function pendingRows(
  transcript: readonly NativeChatMessage[],
  messages: readonly LiveMessage[]
): PendingRow[] {
  const recent = new Map<string, number>()
  for (const m of transcript.slice(-50)) {
    if (m.role === 'user') {
      const text = userText(m)
      recent.set(text, (recent.get(text) ?? 0) + 1)
    }
  }
  const rows: PendingRow[] = []
  for (const message of [...messages].sort((a, b) => a.createdAt - b.createdAt)) {
    if (message.state === 'delivered') {
      const text = words(message.text)
      const seen = recent.get(text) ?? 0
      if (seen > 0) {
        recent.set(text, seen - 1)
        continue
      }
    }
    rows.push({
      message,
      row: {
        id: `live-message:${message.messageId}`,
        role: 'user',
        source: 'transcript',
        timestamp: message.createdAt,
        blocks: [{ type: 'text', text: message.text }]
      }
    })
  }
  return rows
}
