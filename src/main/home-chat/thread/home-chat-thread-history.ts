import type {
  HomeChatAssistantItem,
  HomeChatCompactionItem,
  HomeChatThreadItem,
  HomeChatToolCallPart,
  HomeChatToolResultItem
} from './home-chat-thread-items'

/** A compaction never keeps a tool result without its call, so a missing one is a real gap. */
export const MISSING_RESULT_TEXT =
  'No result was recorded for this call: the turn ended before it answered.'

export type HomeChatConversationItem = Exclude<HomeChatThreadItem, { type: 'event' }>

/** What the model should see: the newest summary, then everything kept after it. */
export function activeItems(items: readonly HomeChatThreadItem[]): HomeChatConversationItem[] {
  const conversation = items.filter((item) => item.type !== 'event')
  const compaction = conversation.findLast((item) => item.type === 'compaction')
  if (!compaction) {
    return conversation
  }
  return [
    compaction,
    ...conversation.filter(
      (item) => item.type !== 'compaction' && item.seq >= compaction.keepFromSeq
    )
  ]
}

export function toolCalls(item: HomeChatAssistantItem): HomeChatToolCallPart[] {
  return item.parts.filter((part) => part.kind === 'tool_call')
}

function missingResult(
  call: HomeChatToolCallPart,
  after: HomeChatThreadItem
): HomeChatThreadItem & HomeChatToolResultItem {
  return {
    type: 'tool_result',
    seq: after.seq,
    id: `${call.id}:missing`,
    at: after.at,
    callId: call.callId,
    tool: call.tool,
    content: MISSING_RESULT_TEXT,
    outcome: 'interrupted'
  }
}

/**
 * Every call answered exactly once, right after the round that made it, and no result without a call.
 * Providers reject anything else, and a stop or crash mid-round leaves exactly these gaps.
 */
export function answeredItems(
  items: readonly HomeChatConversationItem[]
): HomeChatConversationItem[] {
  const results = new Map<string, HomeChatThreadItem & HomeChatToolResultItem>()
  for (const item of items) {
    if (item.type === 'tool_result' && !results.has(item.callId)) {
      results.set(item.callId, item)
    }
  }
  const out: HomeChatConversationItem[] = []
  for (const item of items) {
    if (item.type === 'tool_result') {
      continue
    }
    out.push(item)
    if (item.type === 'assistant') {
      for (const call of toolCalls(item)) {
        out.push(results.get(call.callId) ?? missingResult(call, item))
      }
    }
  }
  return out
}

/** Indexes where a user-visible exchange starts: the user's message or a notice from Seal. */
export function exchangeStarts(items: readonly HomeChatConversationItem[]): number[] {
  return items.flatMap((item, index) =>
    item.type === 'user' && item.origin !== 'system' ? [index] : []
  )
}

/** Indexes where the context may be cut without parting a call from its result. */
export function roundStarts(items: readonly HomeChatConversationItem[]): number[] {
  return items.flatMap((item, index) =>
    item.type === 'user' || item.type === 'assistant' ? [index] : []
  )
}

export function newestCompaction(
  items: readonly HomeChatThreadItem[]
): (HomeChatThreadItem & HomeChatCompactionItem) | undefined {
  return items.findLast((item) => item.type === 'compaction')
}

export function assistantText(item: HomeChatAssistantItem): string {
  return item.parts
    .filter((part) => part.kind === 'text')
    .map((part) => part.text)
    .join('\n\n')
    .trim()
}
