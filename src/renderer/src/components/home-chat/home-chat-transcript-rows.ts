import type { HomeChatEntry } from '../../../../shared/home-chat/home-chat-types'
import type { NativeChatMessage } from '../../../../shared/native-chat/native-chat-types'

type SpokenEntry = Extract<HomeChatEntry, { kind: 'user' | 'assistant' | 'thinking' }>
type ToolEntry = Extract<HomeChatEntry, { kind: 'tool' }>
type OtherEntry = Exclude<HomeChatEntry, SpokenEntry | ToolEntry>

export type HomeChatTranscriptRow =
  | {
      kind: 'message'
      entry: SpokenEntry
      /** The entry as the session transcript's message, so both chats draw it with one row. */
      message: NativeChatMessage
      /** Its response says nothing further, so this row holds the response's actions. */
      endsResponse: boolean
      latestResponse: boolean
    }
  /** Consecutive calls, drawn as one tight group. */
  | { kind: 'tools'; entries: ToolEntry[] }
  | { kind: 'entry'; entry: OtherEntry }

// Entries are replaced when they change, so a message lives as long as its row needs no redraw.
const messages = new WeakMap<SpokenEntry, NativeChatMessage>()

function transcriptMessage(entry: SpokenEntry): NativeChatMessage {
  const held = messages.get(entry)
  if (held) {
    return held
  }
  const message: NativeChatMessage = {
    id: entry.id,
    role: entry.kind === 'user' ? 'user' : entry.kind === 'assistant' ? 'assistant' : 'reasoning',
    blocks: [{ type: 'text', text: entry.text }],
    timestamp: entry.at,
    source: 'transcript',
    ...(entry.kind === 'user' ? {} : { state: entry.streaming ? 'running' : 'completed' }),
    ...(entry.kind === 'thinking' && entry.durationMs !== undefined
      ? { completedAt: entry.at + entry.durationMs }
      : {})
  }
  messages.set(entry, message)
  return message
}

export function homeChatTranscriptRows(entries: readonly HomeChatEntry[]): HomeChatTranscriptRow[] {
  // A response runs to the next thing the user said; its last words hold its actions.
  const endsResponse = new Set<HomeChatEntry>()
  let latestResponse: HomeChatEntry | undefined
  let spokeLater = false
  for (const entry of entries.toReversed()) {
    if (entry.kind === 'user') {
      spokeLater = false
    } else if (entry.kind === 'assistant' && entry.text && !spokeLater) {
      endsResponse.add(entry)
      latestResponse ??= entry
      spokeLater = true
    }
  }
  const rows: HomeChatTranscriptRow[] = []
  for (const entry of entries) {
    if (entry.kind === 'tool') {
      const previous = rows.at(-1)
      if (previous?.kind === 'tools') {
        previous.entries.push(entry)
      } else {
        rows.push({ kind: 'tools', entries: [entry] })
      }
    } else if (entry.kind === 'user' || entry.kind === 'assistant' || entry.kind === 'thinking') {
      rows.push({
        kind: 'message',
        entry,
        message: transcriptMessage(entry),
        endsResponse: endsResponse.has(entry),
        latestResponse: entry === latestResponse
      })
    } else {
      rows.push({ kind: 'entry', entry })
    }
  }
  return rows
}
