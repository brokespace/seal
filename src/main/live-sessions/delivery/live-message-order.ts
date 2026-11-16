import type { DEFAULT_OUTBOX_TIMING, OutboxItem } from './live-message-outbox-types'

/** The oldest message of a session still waiting to be sent that no worker holds. */
export function nextQueued(
  items: Iterable<OutboxItem>,
  sessionId: string,
  claimed: ReadonlySet<string>
): OutboxItem | null {
  let best: OutboxItem | null = null
  for (const item of items) {
    if (
      item.sessionId === sessionId &&
      item.state === 'queued' &&
      !claimed.has(item.messageId) &&
      (!best || item.createdAt < best.createdAt)
    ) {
      best = item
    }
  }
  return best
}

/** An earlier message of the same session is being typed, or was typed too recently to be sure of its place. */
export function aheadInFlight(
  items: Iterable<OutboxItem>,
  item: OutboxItem,
  claimed: ReadonlySet<string>,
  now: number,
  timing: Pick<typeof DEFAULT_OUTBOX_TIMING, 'orderHoldMs'>
): boolean {
  for (const other of items) {
    if (
      other !== item &&
      other.sessionId === item.sessionId &&
      other.createdAt <= item.createdAt &&
      (claimed.has(other.messageId) ||
        (other.state === 'sent' && now - (other.sentAt ?? now) < timing.orderHoldMs))
    ) {
      return true
    }
  }
  return false
}
