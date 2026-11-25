import type { HomeChatEntry, HomeChatToolStatus } from '../../../shared/home-chat/home-chat-types'
import type {
  HomeChatAssistantPart,
  HomeChatThreadItem,
  HomeChatToolOutcome,
  HomeChatToolResultItem
} from './home-chat-thread-items'

export const MAX_UI_OUTPUT_CHARS = 20_000
export const INTERRUPTED_TOOL_TEXT = 'Interrupted before it finished.'
/** Calls that render as something other than a tool card. */
export const HIDDEN_TOOL_CALLS: ReadonlySet<string> = new Set(['report_progress'])

export function toolStatusForOutcome(outcome: HomeChatToolOutcome): HomeChatToolStatus {
  if (outcome === 'ok') {
    return 'ok'
  }
  return outcome === 'denied' ? 'denied' : 'error'
}

function partEntry(
  part: HomeChatAssistantPart,
  at: number,
  result: HomeChatToolResultItem | undefined
): HomeChatEntry {
  const base = { id: part.id, rev: 1, at: part.at ?? at, ord: part.ord }
  if (part.kind === 'text') {
    return { ...base, kind: 'assistant', text: part.text, streaming: false }
  }
  if (part.kind === 'thinking') {
    return {
      ...base,
      kind: 'thinking',
      text: part.text,
      streaming: false,
      ...(part.durationMs !== undefined ? { durationMs: part.durationMs } : {})
    }
  }
  return {
    ...base,
    kind: 'tool',
    tool: part.tool,
    input: part.input,
    status: result ? toolStatusForOutcome(result.outcome) : 'error',
    output: (result?.content ?? INTERRUPTED_TOOL_TEXT).slice(0, MAX_UI_OUTPUT_CHARS),
    ...(result?.machine ? { machine: result.machine } : {}),
    ...(result?.durationMs !== undefined ? { durationMs: result.durationMs } : {}),
    ...(part.approvalReason ? { approvalReason: part.approvalReason } : {})
  }
}

function itemEntries(
  item: HomeChatThreadItem,
  results: ReadonlyMap<string, HomeChatToolResultItem>
): HomeChatEntry[] {
  const base = { id: item.id, rev: 1, at: item.at }
  switch (item.type) {
    case 'user':
      if (item.origin === 'system') {
        return []
      }
      return item.origin === 'notice'
        ? [
            {
              ...base,
              ord: item.ord,
              kind: 'notice',
              source: item.source ?? 'job',
              text: item.text
            }
          ]
        : [{ ...base, ord: item.ord, kind: 'user', text: item.text, delivery: 'delivered' }]
    case 'assistant':
      return item.parts
        .filter((part) =>
          part.kind === 'tool_call' ? !HIDDEN_TOOL_CALLS.has(part.tool) : part.text.trim()
        )
        .map((part) =>
          partEntry(part, item.at, part.kind === 'tool_call' ? results.get(part.callId) : undefined)
        )
    case 'tool_result':
      return []
    case 'compaction':
      return [
        { ...base, ord: item.ord, kind: 'compaction', summary: item.summary, auto: item.auto }
      ]
    case 'event':
      return [{ ...base, ord: item.ord, ...item.event }]
  }
}

/** The thread as the user reads it. Model-only text (system notes, seeds) has no entry at all. */
export function projectHomeChatEntries(items: readonly HomeChatThreadItem[]): HomeChatEntry[] {
  const results = new Map<string, HomeChatToolResultItem>()
  for (const item of items) {
    if (item.type === 'tool_result' && !results.has(item.callId)) {
      results.set(item.callId, item)
    }
  }
  return items.flatMap((item) => itemEntries(item, results)).sort((a, b) => a.ord - b.ord)
}
