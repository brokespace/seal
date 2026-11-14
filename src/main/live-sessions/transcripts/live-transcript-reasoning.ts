// Reasoning rows of a live transcript: when the agent thought and for how long, even where the
// provider stored only a signature or encrypted content instead of the text.
import type { NativeChatMessage } from '../../../shared/native-chat/native-chat-types'
import type { LiveSessionProvider } from '../../../shared/live-sessions/live-session-types'
import { isJsonRecord, type JsonRecord } from '../../../shared/live-sessions/transcript-json-record'

export const UNRECORDED_REASONING_TEXT =
  'The agent reasoned here, but its provider stored the text encrypted, so there is nothing to show.'

function timestampOf(record: JsonRecord): number | null {
  const ms = typeof record.timestamp === 'string' ? Date.parse(record.timestamp) : Number.NaN
  return Number.isFinite(ms) ? ms : null
}

function parts(content: unknown): JsonRecord[] {
  return Array.isArray(content) ? content.filter(isJsonRecord) : []
}

/** Claude Code records a thinking block as its own record, often with an empty `thinking`. */
function claudeThoughtWithoutText(record: JsonRecord): boolean {
  if (record.type !== 'assistant' || !isJsonRecord(record.message)) {
    return false
  }
  const content = parts(record.message.content)
  const onlyThinking = content.every(
    (part) => part.type === 'thinking' || part.type === 'redacted_thinking'
  )
  return onlyThinking && (content.length > 0 || typeof record.thinkingDurationMs === 'number')
}

function codexThoughtWithoutText(record: JsonRecord): boolean {
  const payload = isJsonRecord(record.payload) ? record.payload : null
  return (
    record.type === 'response_item' &&
    payload?.type === 'reasoning' &&
    typeof payload.encrypted_content === 'string'
  )
}

/** A reasoning row for a record the shared decoder drops because it carries no text. */
export function unrecordedReasoning(
  provider: LiveSessionProvider,
  record: JsonRecord,
  id: string
): NativeChatMessage | null {
  const thought =
    provider === 'claude' ? claudeThoughtWithoutText(record) : codexThoughtWithoutText(record)
  return thought
    ? {
        id,
        role: 'reasoning',
        blocks: [{ type: 'text', text: UNRECORDED_REASONING_TEXT }],
        timestamp: timestampOf(record),
        source: 'transcript'
      }
    : null
}

/** A transcript's reasoning is over; with the provider's own duration the row reads "Thought for 4s". */
export function withReasoningSpan(
  message: NativeChatMessage,
  record: JsonRecord
): NativeChatMessage {
  if (message.role !== 'reasoning') {
    return message
  }
  const durationMs = record.thinkingDurationMs
  const endedAt = message.timestamp ?? timestampOf(record)
  return typeof durationMs === 'number' && durationMs > 0 && endedAt !== null
    ? { ...message, state: 'completed', timestamp: endedAt - durationMs, completedAt: endedAt }
    : { ...message, state: 'completed' }
}
