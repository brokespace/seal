// Reasoning rows of a live transcript: the text the provider recorded, where the agent thought it.
// A thought stored without readable text (a signature, redacted or encrypted content) gets no row.
import type { NativeChatMessage } from '../../../shared/native-chat/native-chat-types'
import { isJsonRecord, type JsonRecord } from '../../../shared/live-sessions/transcript-json-record'

function timestampOf(record: JsonRecord): number | null {
  const ms = typeof record.timestamp === 'string' ? Date.parse(record.timestamp) : Number.NaN
  return Number.isFinite(ms) ? ms : null
}

/** Codex keeps raw reasoning text in `content` (open models, `show_raw_agent_reasoning`); the shared decoder reads only the summary. */
export function codexRawReasoning(record: JsonRecord, id: string): NativeChatMessage | null {
  const payload = isJsonRecord(record.payload) ? record.payload : null
  if (record.type !== 'response_item' || payload?.type !== 'reasoning') {
    return null
  }
  const text = (Array.isArray(payload.content) ? payload.content : [])
    .flatMap((part) => (isJsonRecord(part) && typeof part.text === 'string' ? [part.text] : []))
    .join('\n')
    .trim()
  return text
    ? {
        id,
        role: 'reasoning',
        blocks: [{ type: 'text', text }],
        timestamp: timestampOf(record),
        source: 'transcript'
      }
    : null
}

/** A transcript's reasoning is over and reads in place; with the provider's own duration the row reads "Thought for 4s". */
export function withReasoningSpan(
  message: NativeChatMessage,
  record: JsonRecord
): NativeChatMessage {
  if (message.role !== 'reasoning') {
    return message
  }
  const durationMs = record.thinkingDurationMs
  const endedAt = message.timestamp ?? timestampOf(record)
  const shown: NativeChatMessage = { ...message, state: 'completed', shownInline: true }
  return typeof durationMs === 'number' && durationMs > 0 && endedAt !== null
    ? { ...shown, timestamp: endedAt - durationMs, completedAt: endedAt }
    : shown
}
