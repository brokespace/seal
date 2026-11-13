import { describe, expect, it } from 'vitest'
import { mergeHomeChatEntry } from './home-chat-entry-merge'
import type { HomeChatEntry } from './home-chat-types'

function assistant(id: string, rev: number, text: string): HomeChatEntry {
  return { id, rev, at: 1, kind: 'assistant', text, streaming: rev < 3 }
}

describe('mergeHomeChatEntry', () => {
  it('keeps the newest copy of an entry and ignores stale replays', () => {
    let entries = mergeHomeChatEntry([], assistant('a', 1, 'He'))
    entries = mergeHomeChatEntry(entries, assistant('b', 1, 'other'))
    entries = mergeHomeChatEntry(entries, assistant('a', 3, 'Hello'))
    entries = mergeHomeChatEntry(entries, assistant('a', 2, 'Hel'))

    expect(entries.map((e) => [e.id, e.kind === 'assistant' ? e.text : ''])).toEqual([
      ['a', 'Hello'],
      ['b', 'other']
    ])
  })
})
