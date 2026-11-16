import type { LiveMessage } from './live-session-types'

type TranscriptRow = {
  role: string
  timestamp?: number | null
  transcriptOffset?: number
  blocks: readonly { type: string; text?: string }[]
}

type SentMessage = Pick<
  LiveMessage,
  'text' | 'state' | 'createdAt' | 'updatedAt' | 'sentOffset' | 'echoOffset'
>

export type PendingLiveMessage<M> = {
  message: M
  /** The transcript offset it was written at: it goes before the rows from there on. Null: after every row. */
  at: number | null
}

const spaced = (text: string): string => text.split(/\s+/).filter(Boolean).join(' ')

/** How many times `said` holds `text` as whole words, both with one space between words. */
export function timesSaid(said: string, text: string): number {
  if (!text) {
    return 0
  }
  // Two spaces between words: "ok ok" holds "ok" twice, and two finds must not share a space.
  const apart = (words: string): string => ` ${words.split(' ').join('  ')} `
  return apart(said).split(apart(text)).length - 1
}

/**
 * Messages sent from Seal that the transcript read so far does not hold, oldest first, each with
 * the place it was written at. `rows` is what is loaded; `readTo` is how far the transcript has
 * been read (null before the first read), which may be far past the oldest loaded row.
 *
 * A delivered message is in the transcript: it stays only for the moment between its delivery
 * being seen and the transcript being read that far.
 */
export function pendingLiveMessages<M extends SentMessage>(
  rows: readonly TranscriptRow[],
  readTo: number | null,
  messages: readonly M[]
): PendingLiveMessage<M>[] {
  let newest = 0
  const loaded = new Set<number | undefined>()
  for (const row of rows) {
    newest = Math.max(newest, row.timestamp ?? 0)
    loaded.add(row.transcriptOffset)
  }
  // Why by time and text at all: a host from before `echoOffset` says only that the message was delivered.
  let said: string[] | null = null
  const taken = new Map<string, number>()
  const saidInLoadedRows = (text: string): boolean => {
    said ??= rows
      .filter((row) => row.role === 'user')
      .map((row) =>
        spaced(row.blocks.map((block) => (block.type === 'text' ? block.text : '')).join('\n'))
      )
    return said.some((row, at) => {
      const key = `${at}\n${text}`
      const used = taken.get(key) ?? 0
      const found = timesSaid(row, text) > used
      if (found) {
        taken.set(key, used + 1)
      }
      return found
    })
  }
  const inTranscript = (message: M): boolean => {
    const echo = message.echoOffset
    if (typeof echo === 'number') {
      // Offsets only: a row's time is its machine's clock, which need not agree with this one's.
      // Why the loaded row too: a chat's journal counts writes, and its read position is the last one read.
      return readTo === null || echo < readTo || loaded.has(echo)
    }
    return message.updatedAt < newest || saidInLoadedRows(spaced(message.text))
  }
  const pending: PendingLiveMessage<M>[] = []
  for (const message of [...messages].sort((a, b) => a.createdAt - b.createdAt)) {
    if (message.state !== 'delivered' || !inTranscript(message)) {
      pending.push({ message, at: message.sentOffset ?? null })
    }
  }
  return pending
}

/**
 * The loaded rows with each pending message where it was written, for a list that draws its rows
 * in the order given: a message goes above the first row written at or after its place.
 */
export function withPendingLiveMessages<R extends { transcriptOffset?: number }, M, T>(
  rows: readonly R[],
  pending: readonly PendingLiveMessage<M>[],
  rowItem: (row: R) => T,
  pendingItem: (message: M) => T
): T[] {
  const placed: { message: M; at: number }[] = []
  const last: M[] = []
  for (const { message, at } of pending) {
    if (at === null) {
      last.push(message)
    } else {
      placed.push({ message, at })
    }
  }
  placed.sort((a, b) => a.at - b.at)
  const out: T[] = []
  let next = 0
  for (const row of rows) {
    while (next < placed.length && placed[next].at <= (row.transcriptOffset ?? 0)) {
      out.push(pendingItem(placed[next++].message))
    }
    out.push(rowItem(row))
  }
  for (const { message } of placed.slice(next)) {
    out.push(pendingItem(message))
  }
  return [...out, ...last.map(pendingItem)]
}
