import type { NativeChatMessage } from '../../../../shared/native-chat/native-chat-types'
import { pendingLiveMessages } from '../../../../shared/live-sessions/live-session-pending-messages'
import type { LiveMessage } from '../../../../shared/live-sessions/live-session-types'

export type PendingRow = { row: NativeChatMessage; message: LiveMessage }

/**
 * Outbox messages the transcript read to `readTo` doesn't hold yet, as user rows. Each sorts where
 * it was written, above what the agent wrote since; one without a place sorts after every row.
 */
export function pendingRows(
  transcript: readonly NativeChatMessage[],
  readTo: number | null,
  messages: readonly LiveMessage[]
): PendingRow[] {
  return pendingLiveMessages(transcript, readTo, messages).map(({ message, at }) => ({
    message,
    row: {
      id: `live-message:${message.messageId}`,
      role: 'user',
      source: 'transcript',
      timestamp: message.createdAt,
      // Transcript rows sort by their byte offset: half a byte earlier is just before the row there.
      ...(at === null ? {} : { transcriptOrder: at - 0.5 }),
      blocks: [{ type: 'text', text: message.text }]
    }
  }))
}
