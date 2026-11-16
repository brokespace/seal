import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../shared/native-chat/native-chat-types'
import type { SessionTranscript } from '../transcripts/session-transcript'
import { watchJournalTranscript } from './journal-transcript-watch'

const row = (id: string, role: NativeChatMessage['role'], text: string): NativeChatMessage => ({
  id,
  role,
  blocks: [{ type: 'text', text }],
  timestamp: 1000,
  source: 'transcript'
})

const ASKED = row('m1', 'user', 'Fix the build')
const REPLIED = row('m2', 'assistant', 'Done.')
const ASKED_AGAIN = row('m3', 'user', 'Try again')

function journalOf(rows: NativeChatMessage[]): SessionTranscript {
  return {
    page: async () => ({
      sessionId: 'local:claude:abc',
      messages: [...rows],
      cursor: rows.length,
      start: 0,
      more: false
    }),
    since: async (cursor) =>
      cursor > rows.length
        ? { messages: [], cursor, shrank: true }
        : { messages: rows.slice(cursor), cursor: rows.length, shrank: false }
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe("watching a chat's journal", () => {
  it('gives the page, then each new row, then the whole chat again after a rewind', async () => {
    vi.useFakeTimers()
    const rows = [ASKED]
    const deltas: unknown[] = []

    const watch = watchJournalTranscript(
      'local:claude:abc',
      () => journalOf(rows),
      null,
      (delta) => deltas.push(delta),
      { pollMs: 100 }
    )
    expect(await watch.ready).toEqual({
      sessionId: 'local:claude:abc',
      messages: [ASKED],
      cursor: 1,
      start: 0,
      more: false
    })

    rows.push(REPLIED)
    await vi.advanceTimersByTimeAsync(100)
    expect(deltas).toEqual([
      { sessionId: 'local:claude:abc', from: 1, cursor: 2, messages: [REPLIED] }
    ])

    rows.splice(0, rows.length, ASKED_AGAIN)
    await vi.advanceTimersByTimeAsync(100)
    expect(deltas[1]).toEqual({
      sessionId: 'local:claude:abc',
      from: 2,
      cursor: 1,
      messages: [ASKED_AGAIN],
      reset: true
    })

    watch.unsubscribe()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('picks up from a cursor the watcher already holds', async () => {
    vi.useFakeTimers()
    const deltas: unknown[] = []

    const watch = watchJournalTranscript(
      'local:claude:abc',
      () => journalOf([ASKED, REPLIED]),
      1,
      (delta) => deltas.push(delta),
      { pollMs: 100 }
    )
    expect(await watch.ready).toBeNull()
    await vi.advanceTimersByTimeAsync(0)

    expect(deltas).toEqual([
      { sessionId: 'local:claude:abc', from: 1, cursor: 2, messages: [REPLIED] }
    ])
    watch.unsubscribe()
  })
})
