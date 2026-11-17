// Which user message each request of a pass comes from: the model's own citation corrected, and
// the requests the host wrote down itself matched to the model's once it reads the same messages.
import type { RecapItem, SessionRecap } from '../../shared/session-recap/session-recap-types'
import type { RecapDelta } from './session-recap-delta'
import { applyRecapDelta, recapFallbackDelta } from './session-recap-merge'
import type { RecapEntry } from './session-recap-transcript'

/**
 * A request is the user's, so it comes from a user message. The model cites the agent's reply, or
 * no message, for about a quarter of them: such a request goes to the user message that reply
 * answers, or to the chunk's only one. With neither it has no message, and stays "Open".
 */
export function attachRecapRequests(
  delta: RecapDelta,
  entries: readonly RecapEntry[],
  refOf: (entry: RecapEntry) => string
): RecapDelta {
  const users = entries.filter((entry) => entry.role === 'user')
  const userRef = (ref: string | null): string | null => {
    const cited = entries.findIndex((entry) => refOf(entry) === ref)
    if (cited === -1) {
      return users.length === 1 ? refOf(users[0]) : null
    }
    const asked = entries.slice(0, cited + 1).findLast((entry) => entry.role === 'user')
    return asked ? refOf(asked) : null
  }
  return {
    ...delta,
    add: {
      ...delta.add,
      asked: delta.add.asked.map((item) => ({ ...item, ref: userRef(item.ref) }))
    }
  }
}

/** What the host can say of the chunks without the model: the user's requests, by their first lines. */
export function recapWithHostRequests(
  start: SessionRecap,
  chunks: readonly RecapEntry[][],
  now: number
): SessionRecap {
  return chunks.reduce(
    (recap, chunk) =>
      applyRecapDelta(
        recap,
        recapFallbackDelta(chunk, (entry) => entry.messageId),
        { now, refs: new Map(chunk.map((entry) => [entry.messageId, entry.messageId])) }
      ),
    start
  )
}

/** Requests the host wrote down for these entries while the model's replies could not be read. */
export function recapHostRequests(
  recap: SessionRecap,
  entries: readonly RecapEntry[]
): RecapItem[] {
  const written = recapFallbackDelta(entries, (entry) => entry.messageId).add.asked
  return recap.asked.filter((item) =>
    written.some((line) => line.ref === item.messageId && line.text === item.text)
  )
}

/**
 * The model has now read the messages the host wrote requests down for: its request for a message
 * takes the id of the host's, so the request's status and the user's mark stay with it.
 */
export function keepRecapHostRequestIds(
  recap: SessionRecap,
  before: SessionRecap,
  host: readonly RecapItem[]
): SessionRecap {
  const had = new Set(before.asked.map((item) => item.id))
  const taken = new Set<string>()
  const asked = recap.asked.map((item) => {
    const written = had.has(item.id)
      ? undefined
      : host.find((line) => line.messageId === item.messageId && !taken.has(line.id))
    if (!written) {
      return item
    }
    taken.add(written.id)
    return { ...item, id: written.id, at: written.at }
  })
  return taken.size > 0 ? { ...recap, asked } : recap
}
