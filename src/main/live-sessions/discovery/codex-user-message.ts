import {
  isJsonRecord,
  recordField,
  type JsonRecord
} from '../../../shared/live-sessions/transcript-json-record'

/**
 * The text of a user turn in a Codex rollout. Older Codex writes `event_msg/user_message`; 0.16x
 * writes `event_msg/item_completed` with a `UserMessage` item. Both also echo a `response_item`,
 * which is skipped so a prompt counts once.
 */
export function codexUserMessageText(record: JsonRecord): string | null {
  if (record.type !== 'event_msg') {
    return null
  }
  const payload = recordField(record, 'payload')
  if (payload?.type === 'user_message') {
    return typeof payload.message === 'string' ? payload.message : null
  }
  const item = recordField(payload, 'item')
  if (payload?.type !== 'item_completed' || item?.type !== 'UserMessage') {
    return null
  }
  const parts = Array.isArray(item.content) ? item.content : []
  const text = parts
    .flatMap((part) => (isJsonRecord(part) && typeof part.text === 'string' ? [part.text] : []))
    .join('\n')
  return text || null
}
