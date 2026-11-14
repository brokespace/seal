import {
  modelTextForUserItem,
  SUMMARY_HEADING,
  systemNote
} from '../../engine/home-chat-system-note'
import { answeredItems, type HomeChatConversationItem } from '../../thread/home-chat-thread-history'
import type { OpenAiChatMessage, OpenAiToolCall } from './openai-stream-accumulator'

/**
 * Thread items as Chat Completions messages. Tool calls replay as `tool_calls` with their `tool`
 * answers right behind them, which is the only order providers accept.
 */
export function encodeOpenAiMessages(
  systemPrompt: string,
  items: readonly HomeChatConversationItem[]
): OpenAiChatMessage[] {
  const messages: OpenAiChatMessage[] = [{ role: 'system', content: systemPrompt }]
  for (const item of answeredItems(items)) {
    switch (item.type) {
      case 'compaction':
        messages.push({
          role: 'user',
          content: systemNote(`${SUMMARY_HEADING}\n\n${item.summary}`)
        })
        break
      case 'user':
        messages.push({ role: 'user', content: modelTextForUserItem(item) })
        break
      case 'tool_result':
        messages.push({ role: 'tool', tool_call_id: item.callId, content: item.content })
        break
      case 'assistant': {
        const text = item.parts
          .filter((part) => part.kind === 'text')
          .map((part) => part.text)
          .join('')
        const calls = item.parts.flatMap((part): OpenAiToolCall[] =>
          part.kind === 'tool_call'
            ? [
                {
                  id: part.callId,
                  type: 'function',
                  function: { name: part.tool, arguments: JSON.stringify(part.input) }
                }
              ]
            : []
        )
        if (text || calls.length > 0) {
          messages.push({
            role: 'assistant',
            content: text || null,
            ...(calls.length ? { tool_calls: calls } : {})
          })
        }
        break
      }
    }
  }
  return messages
}
