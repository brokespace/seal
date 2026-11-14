import { answeredItems, type HomeChatConversationItem } from '../thread/home-chat-thread-history'
import { modelTextForUserItem, SUMMARY_HEADING, systemNote } from './home-chat-system-note'

const MAX_TOOL_TEXT = 2_000
const MAX_SEED_CHARS = 120_000

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)} ... [${text.length - max} more chars]`
}

function renderItem(item: HomeChatConversationItem, results: Map<string, string>): string[] {
  switch (item.type) {
    case 'compaction':
      return [`${SUMMARY_HEADING}\n${item.summary}`]
    case 'user':
      return [`User: ${modelTextForUserItem(item)}`]
    case 'tool_result':
      return []
    case 'assistant':
      return item.parts.flatMap((part) => {
        if (part.kind === 'text') {
          return part.text.trim() ? [`Assistant: ${part.text.trim()}`] : []
        }
        if (part.kind === 'thinking') {
          return []
        }
        const result = results.get(part.callId) ?? ''
        return [
          `Assistant called ${part.tool} ${clip(JSON.stringify(part.input), MAX_TOOL_TEXT)}\nResult: ${clip(result, MAX_TOOL_TEXT)}`
        ]
      })
  }
}

/** Plain-text replay of thread items, for a provider session that never saw them. */
export function renderTranscript(items: readonly HomeChatConversationItem[]): string {
  const answered = answeredItems(items)
  const results = new Map<string, string>()
  for (const item of answered) {
    if (item.type === 'tool_result') {
      results.set(item.callId, item.content)
    }
  }
  const lines = answered.flatMap((item) => renderItem(item, results))
  let text = lines.join('\n\n')
  // The newest turns matter most; the summary line, when present, is first and stays.
  while (text.length > MAX_SEED_CHARS && lines.length > 2) {
    lines.splice(1, 1)
    text = lines.join('\n\n')
  }
  return text
}

/**
 * The prompt for a CLI session that is missing part of the thread: what it missed, then the new message.
 * Only the provider receives this; the thread stores and shows the message alone.
 */
export function seededPrompt(missed: readonly HomeChatConversationItem[], message: string): string {
  const transcript = renderTranscript(missed)
  if (!transcript) {
    return message
  }
  return `${systemNote(
    `This conversation has earlier turns that are not in your session. They are replayed below so you can continue it; treat them as what was already said and done, not as new requests.\n\n${transcript}`
  )}\n\nThe new message follows.\n\n${message}`
}
