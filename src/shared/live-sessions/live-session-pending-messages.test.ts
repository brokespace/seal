import { describe, expect, it } from 'vitest'
import type { LiveMessage } from './live-session-types'
import {
  pendingLiveMessages,
  timesSaid,
  withPendingLiveMessages
} from './live-session-pending-messages'

type Row = Parameters<typeof pendingLiveMessages>[0][number] & { transcriptOffset: number }

const row = (offset: number, role: string, text: string, timestamp = offset): Row => ({
  role,
  timestamp,
  transcriptOffset: offset,
  blocks: [{ type: 'text', text }]
})

const message = (
  messageId: string,
  text: string,
  state: LiveMessage['state'],
  at: number,
  place: Pick<LiveMessage, 'sentOffset' | 'echoOffset'> = {}
): LiveMessage => ({
  messageId,
  sessionId: 's',
  text,
  state,
  route: 'tmux',
  error: null,
  createdAt: at,
  updatedAt: at,
  ...place
})

const ids = (pending: { message: LiveMessage; at: number | null }[]) =>
  pending.map((p) => [p.message.messageId, p.at])

/** A user row at offset 100, then `count` agent rows 100 bytes apart. */
function busyTranscript(count: number): Row[] {
  const rows = [row(100, 'user', 'run the tests')]
  for (let i = 1; i <= count; i++) {
    rows.push(row(100 + i * 100, 'assistant', i % 25 === 0 ? `reply ${i}` : 'tool call'))
  }
  return rows
}

describe('pendingLiveMessages', () => {
  it('drops a delivered message whose row is near the top of a 130-message transcript, loaded or not', () => {
    const rows = busyTranscript(129)
    const readTo = 13_100
    // Delivery was seen long after: no row is newer than it, so only the offset can tell.
    const sent = [
      message('a', 'run the tests', 'delivered', 50_000, { sentOffset: 100, echoOffset: 100 })
    ]
    expect(pendingLiveMessages(rows, readTo, sent)).toEqual([])
    expect(pendingLiveMessages(rows.slice(-80), readTo, sent)).toEqual([])
    expect(pendingLiveMessages(rows.slice(-10), readTo, sent)).toEqual([])
  })

  it('places a prompt queued mid-turn where it was written, then drops it once its echo is read', () => {
    const rows = [row(100, 'user', 'start'), row(200, 'assistant', 'working on it')]
    for (let i = 0; i < 60; i++) {
      rows.push(row(400 + i * 100, 'assistant', 'tool turn'))
    }
    const sent = message('a', 'also lint', 'sent', 250, { sentOffset: 300 })
    expect(ids(pendingLiveMessages(rows, 6_400, [sent]))).toEqual([['a', 300]])

    const echoed = [...rows, row(6_400, 'user', 'also lint')]
    const delivered = { ...sent, state: 'delivered' as const, updatedAt: 99_000, echoOffset: 6_400 }
    // Delivery is seen before the transcript is read that far: it waits, still where it was written.
    expect(ids(pendingLiveMessages(rows, 6_400, [delivered]))).toEqual([['a', 300]])
    expect(pendingLiveMessages(echoed, 6_500, [delivered])).toEqual([])
    expect(pendingLiveMessages(echoed.slice(-20), 6_500, [delivered])).toEqual([])
  })

  it("goes by offsets, not by a remote machine's clock", () => {
    const hour = 3_600_000
    const sent = message('a', 'also lint', 'delivered', 5_000, { sentOffset: 300, echoOffset: 700 })
    // The host's clock runs an hour ahead: its rows look newer than the delivery, yet the echo is not read.
    const ahead = [row(200, 'assistant', 'on it', hour), row(400, 'assistant', 'tool', hour + 1)]
    expect(ids(pendingLiveMessages(ahead, 700, [sent]))).toEqual([['a', 300]])
    // An hour behind: no row looks newer than the delivery, and the echo is read and scrolled out.
    const behind = [row(800, 'assistant', 'tool', 5_000 - hour), row(900, 'assistant', 'done', 0)]
    expect(pendingLiveMessages(behind, 1_000, [sent])).toEqual([])
  })

  it('drops a delivered message whose row is loaded when the read position is that very row', () => {
    const journal = [row(7, 'assistant', 'done'), row(8, 'user', 'and lint')]
    const sent = message('a', 'and lint', 'delivered', 50_000, { sentOffset: 8, echoOffset: 8 })
    expect(pendingLiveMessages(journal, 8, [sent])).toEqual([])
    expect(ids(pendingLiveMessages(journal.slice(0, 1), 7, [sent]))).toEqual([['a', 8]])
  })

  it('shows a row 51 to 80 messages back exactly once, with or without its echo offset', () => {
    const rows = busyTranscript(60).slice(-80)
    expect(rows[0].role).toBe('user')
    const old = message('a', 'run the tests', 'delivered', 50_000)
    expect(pendingLiveMessages(rows, 6_200, [old])).toEqual([])
    expect(pendingLiveMessages(rows, 6_200, [{ ...old, echoOffset: 100 }])).toEqual([])
  })

  it('without an echo offset, drops delivered messages joined in one row, once each', () => {
    const pending = pendingLiveMessages([row(100, 'user', 'use pnpm\nok\nok', 0)], 200, [
      message('a', 'use pnpm', 'delivered', 1),
      message('b', 'ok', 'delivered', 2),
      message('c', 'ok', 'delivered', 3),
      message('d', 'ok', 'delivered', 4)
    ])
    expect(ids(pending)).toEqual([['d', null]])
  })

  it('without an echo offset, drops a delivered message once a newer row is loaded', () => {
    const scrolledOut = [row(500, 'assistant', 'done', 2000)]
    expect(pendingLiveMessages(scrolledOut, 600, [message('a', 'run', 'delivered', 900)])).toEqual(
      []
    )
    expect(
      ids(pendingLiveMessages(scrolledOut, 600, [message('b', 'and lint', 'delivered', 3000)]))
    ).toEqual([['b', null]])
  })

  it('drops a message on its way once a row written after it says it, before its delivery is seen', () => {
    const rows = [row(100, 'user', 'ok'), row(200, 'assistant', 'done'), row(300, 'user', 'ok')]
    const first = message('a', 'ok', 'delivered', 1, { sentOffset: 100, echoOffset: 100 })
    const second = message('b', 'ok', 'sent', 2, { sentOffset: 300 })
    const third = message('c', 'ok', 'sending', 3, { sentOffset: 300 })
    // The row at 300 is the second's; the third says the same and still waits for a row of its own.
    expect(ids(pendingLiveMessages(rows, 400, [first, second, third]))).toEqual([['c', 300]])
    // The first's row is its own: a message sent before that row was written does not take it.
    const early = message('d', 'ok', 'sent', 0, { sentOffset: 50 })
    expect(ids(pendingLiveMessages(rows.slice(0, 2), 300, [first, early]))).toEqual([['d', 50]])
  })

  it('keeps undelivered messages in send order even when a row says the same', () => {
    const pending = pendingLiveMessages([row(100, 'user', 'ok', 0)], 200, [
      message('c', 'ok', 'failed', 3, { sentOffset: 150 }),
      message('a', 'ok', 'queued', 1),
      message('b', 'ok', 'sending', 2, { sentOffset: 200 })
    ])
    expect(ids(pending)).toEqual([
      ['a', null],
      ['b', 200],
      ['c', 150]
    ])
  })
})

describe('withPendingLiveMessages', () => {
  it('puts each pending message above the first row written at or after its place', () => {
    const rows = [
      row(100, 'user', 'start'),
      row(200, 'assistant', 'on it'),
      row(400, 'assistant', 'reply')
    ]
    const pending = [
      { message: 'never placed', at: null },
      { message: 'typed now', at: 500 },
      { message: 'typed mid-turn', at: 300 },
      { message: 'typed after it', at: 300 }
    ]
    expect(
      withPendingLiveMessages(
        rows,
        pending,
        (r) => `o${r.transcriptOffset}`,
        (m) => m
      )
    ).toEqual([
      'o100',
      'o200',
      'typed mid-turn',
      'typed after it',
      'o400',
      'typed now',
      'never placed'
    ])
  })
})

describe('timesSaid', () => {
  it('counts whole words only, and a repeat beside itself', () => {
    expect(timesSaid('look ok', 'ok')).toBe(1)
    expect(timesSaid('ok ok ok', 'ok')).toBe(3)
    expect(timesSaid('a b a b', 'a b')).toBe(2)
    expect(timesSaid('ok', '')).toBe(0)
  })
})
