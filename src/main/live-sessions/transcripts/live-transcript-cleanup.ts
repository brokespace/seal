import type {
  NativeChatBlock,
  NativeChatMessage
} from '../../../shared/native-chat/native-chat-types'
import { NATIVE_CHAT_NOTICE_COPY } from '../../../shared/native-chat/native-chat-notice'
import type { LiveSessionProvider } from '../../../shared/live-sessions/live-session-types'
import { isJsonRecord, parseJsonRecord } from '../../../shared/live-sessions/transcript-json-record'

// Context agents and Seal splice into a user turn; never words the user typed.
const SPLICED = /<(system-reminder|earlier_conversation|seal_notification)>[\s\S]*?<\/\1>\s*/g
const LEADING_WRAPPER = /^\s*<([a-z][a-z0-9_-]*)(?:\s[^>]*)?>[\s\S]*?<\/\1>\s*/
const INJECTED_PREFIX =
  /^\s*(?:# AGENTS\.md instructions|Caveat: The messages below were generated)/
const SUMMARIZED = /^\s*<earlier_conversation>/
const CLAUDE_CONTINUATION = /^\s*This session is being continued from a previous conversation/

export type LiveTranscriptClass = 'conversation' | 'hidden' | 'summarized'

/** How a raw record reads in a live session, before the shared decoder sees it. */
export function classifyLiveTranscriptRecord(
  provider: LiveSessionProvider,
  line: string
): LiveTranscriptClass {
  const record = parseJsonRecord(line)
  if (!record) {
    return 'hidden'
  }
  if (provider === 'claude') {
    if (record.isCompactSummary === true) {
      return 'summarized'
    }
    return record.type === 'summary' || record.type === 'system' || record.isSidechain === true
      ? 'hidden'
      : 'conversation'
  }
  if (record.type === 'compacted') {
    return 'summarized'
  }
  const payload = isJsonRecord(record.payload) ? record.payload : null
  // Rollouts record each turn as an event too; the response-item copy carries injected context.
  return record.type === 'response_item' && payload?.type === 'message' ? 'hidden' : 'conversation'
}

/** Text made only of whole `<tag>…</tag>` wrappers is model context, not a message. */
function isInjectedText(text: string): boolean {
  if (INJECTED_PREFIX.test(text)) {
    return true
  }
  let rest = text
  for (let match = LEADING_WRAPPER.exec(rest); match; match = LEADING_WRAPPER.exec(rest)) {
    rest = rest.slice(match[0].length)
  }
  return rest !== text && rest.trim() === ''
}

function cleanBlock(block: NativeChatBlock, role: NativeChatMessage['role']): NativeChatBlock[] {
  if (block.type !== 'text' || block.presentation !== undefined || block.tone !== undefined) {
    return [block]
  }
  const text = block.text.replace(SPLICED, '').trim()
  if (!text || (role === 'user' && isInjectedText(text))) {
    return []
  }
  return [{ ...block, text }]
}

export function summarizedDivider(id: string, timestamp: number | null): NativeChatMessage {
  return {
    id,
    role: 'system',
    blocks: [
      { type: 'text', text: NATIVE_CHAT_NOTICE_COPY.compaction, presentation: 'compaction' }
    ],
    timestamp,
    source: 'transcript'
  }
}

/** The message as the user should read it: wrappers gone, a handed-over summary folded to a divider. */
export function cleanLiveTranscriptMessage(message: NativeChatMessage): NativeChatMessage[] {
  const first = message.blocks[0]
  const lead = message.role === 'user' && first?.type === 'text' ? first.text : ''
  const blocks = message.blocks.flatMap((block) => cleanBlock(block, message.role))
  if (CLAUDE_CONTINUATION.test(lead)) {
    return [summarizedDivider(message.id, message.timestamp)]
  }
  if (!SUMMARIZED.test(lead)) {
    return blocks.length > 0 ? [{ ...message, blocks }] : []
  }
  const divider = summarizedDivider(`${message.id}s`, message.timestamp)
  return blocks.length > 0 ? [divider, { ...message, blocks }] : [divider]
}
