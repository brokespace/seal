import type { HomeChatEntry } from './home-chat-types'

/**
 * Upsert by id, kept in thread order. An older or equal revision never replaces a newer copy, so
 * replays are harmless, and a late arrival lands where it belongs rather than at the end.
 */
export function mergeHomeChatEntry(
  entries: HomeChatEntry[],
  entry: HomeChatEntry
): HomeChatEntry[] {
  const index = entries.findIndex((existing) => existing.id === entry.id)
  if (index !== -1) {
    if (entries[index].rev >= entry.rev) {
      return entries
    }
    const next = entries.slice()
    next[index] = entry
    return next
  }
  let at = entries.length
  while (at > 0 && entries[at - 1].ord > entry.ord) {
    at--
  }
  return [...entries.slice(0, at), entry, ...entries.slice(at)]
}

export function mergeHomeChatEntries(
  entries: HomeChatEntry[],
  incoming: readonly HomeChatEntry[]
): HomeChatEntry[] {
  return incoming.reduce(mergeHomeChatEntry, entries)
}
