import type {
  HomeChatMemory,
  HomeChatMemoryItem
} from '../../../shared/home-chat/home-chat-memory-types'

const RECENT_JOURNAL_ENTRIES = 15
const MAX_FACTS_CHARS = 12_000

function day(at: number): string {
  return new Date(at).toISOString().slice(0, 10)
}

function bullet(item: HomeChatMemoryItem): string {
  return `- [${item.id}] ${item.text}`
}

/** The memory section of the system prompt; machine notes ride along with the machine list. */
export function renderHomeChatMemory(memory: HomeChatMemory): string {
  const parts: string[] = []
  parts.push(
    memory.rules.length
      ? `### Standing rules (always follow these)\n${memory.rules.map(bullet).join('\n')}`
      : '### Standing rules\n(none yet)'
  )
  let facts = memory.facts.map(bullet).join('\n')
  if (facts.length > MAX_FACTS_CHARS) {
    facts = `${facts.slice(0, MAX_FACTS_CHARS)}\n… (more facts stored; ask the user to prune memory)`
  }
  parts.push(`### Facts\n${facts || '(none yet)'}`)
  const recent = memory.journal.slice(-RECENT_JOURNAL_ENTRIES)
  const older = memory.journal.length - recent.length
  parts.push(
    `### Journal (most recent ${recent.length}${older > 0 ? ` of ${memory.journal.length}` : ''})\n${
      recent.map((item) => `- ${day(item.at)} ${item.text}`).join('\n') || '(empty)'
    }`
  )
  return parts.join('\n\n')
}
