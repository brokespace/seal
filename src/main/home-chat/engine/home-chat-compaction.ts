import {
  assistantText,
  exchangeStarts,
  roundStarts,
  type HomeChatConversationItem
} from '../thread/home-chat-thread-history'

/** Compact once the next request would fill this much of the window. */
export const COMPACT_AT_FRACTION = 0.8
/** Keep the newest exchanges word for word, as long as they fit in this much of the window. */
export const KEEP_FRACTION = 0.25
export const KEEP_EXCHANGES = 3

const CHARS_PER_TOKEN = 3.5
const ITEM_OVERHEAD_TOKENS = 6

export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

export function estimateItemTokens(item: HomeChatConversationItem): number {
  switch (item.type) {
    case 'user':
      return ITEM_OVERHEAD_TOKENS + estimateTextTokens(item.text)
    case 'tool_result':
      return ITEM_OVERHEAD_TOKENS + estimateTextTokens(item.content)
    case 'compaction':
      return ITEM_OVERHEAD_TOKENS + estimateTextTokens(item.summary)
    case 'assistant':
      return item.parts.reduce(
        (sum, part) =>
          sum +
          (part.kind === 'tool_call'
            ? estimateTextTokens(part.tool) + estimateTextTokens(JSON.stringify(part.input))
            : // Thinking is never replayed.
              part.kind === 'text'
              ? estimateTextTokens(part.text)
              : 0),
        ITEM_OVERHEAD_TOKENS
      )
  }
}

export function estimateItemsTokens(items: readonly HomeChatConversationItem[]): number {
  return items.reduce((sum, item) => sum + estimateItemTokens(item), 0)
}

/** Blend the provider's own count into the estimate so it tracks the real tokenizer. */
export function calibratedRatio(
  previous: number | undefined,
  estimated: number,
  measured: number
): number {
  if (estimated <= 0 || measured <= 0) {
    return previous ?? 1
  }
  const observed = Math.min(3, Math.max(0.3, measured / estimated))
  return previous === undefined ? observed : previous * 0.5 + observed * 0.5
}

export function compactionDue(usedTokens: number, windowTokens: number): boolean {
  return windowTokens > 0 && usedTokens >= windowTokens * COMPACT_AT_FRACTION
}

/**
 * Where the verbatim tail starts: the newest few exchanges when they fit, else as many whole rounds as
 * fit. Cuts fall only where a round starts, so a tool call is never parted from its result.
 * Returns items.length when not even the newest round fits; the summary then carries everything.
 */
export function tailStartIndex(
  items: readonly HomeChatConversationItem[],
  keepBudgetTokens: number,
  ratio = 1
): number {
  const fits = (index: number): boolean =>
    estimateItemsTokens(items.slice(index)) * ratio <= keepBudgetTokens
  const exchanges = exchangeStarts(items).slice(-KEEP_EXCHANGES)
  const exchange = exchanges.find(fits)
  if (exchange !== undefined) {
    return exchange
  }
  return roundStarts(items).find(fits) ?? items.length
}

/** The user's newest real message, restated in the summary so a compaction never loses the task. */
export function latestRequest(items: readonly HomeChatConversationItem[]): string | null {
  const latest = items.findLast((item) => item.type === 'user' && item.origin === 'user')
  return latest?.type === 'user' ? latest.text : null
}

const MAX_FALLBACK_LINE = 240

/** Used when the model cannot be asked for a summary: terse, but nothing is silently dropped. */
export function mechanicalSummary(items: readonly HomeChatConversationItem[]): string {
  const clip = (text: string): string =>
    text.replace(/\s+/g, ' ').trim().slice(0, MAX_FALLBACK_LINE)
  const lines = items.flatMap((item): string[] => {
    switch (item.type) {
      case 'compaction':
        return [item.summary]
      case 'user':
        return item.origin === 'system' ? [] : [`- User: ${clip(item.text)}`]
      case 'assistant': {
        const said = assistantText(item)
        const calls = item.parts.flatMap((part) =>
          part.kind === 'tool_call' ? [`${part.tool} ${clip(JSON.stringify(part.input))}`] : []
        )
        return [
          ...(said ? [`- Assistant: ${clip(said)}`] : []),
          ...calls.map((call) => `- Assistant ran ${call}`)
        ]
      }
      case 'tool_result':
        return item.outcome === 'ok' ? [] : [`  (that call failed: ${clip(item.content)})`]
    }
  })
  return `(Condensed automatically; details were dropped.)\n${lines.join('\n')}`
}

export function withLatestRequest(summary: string, request: string | null): string {
  return request
    ? `${summary.trim()}\n\nThe user's most recent message, word for word:\n${request}`
    : summary.trim()
}
