import type { HomeChatEntry } from './home-chat-types'

/** Upsert by id; an older or equal revision never replaces a newer copy, so replays are harmless. */
export function mergeHomeChatEntry(
  entries: readonly HomeChatEntry[],
  entry: HomeChatEntry
): HomeChatEntry[] {
  const index = entries.findIndex((existing) => existing.id === entry.id)
  if (index === -1) {
    return [...entries, entry]
  }
  if (entries[index].rev >= entry.rev) {
    return entries as HomeChatEntry[]
  }
  const next = entries.slice()
  next[index] = entry
  return next
}
