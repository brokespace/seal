import type { LiveSession } from '../../../shared/live-sessions/live-session-types'
import type { DEFAULT_OUTBOX_TIMING, OutboxItem } from './live-message-outbox-types'
import { matchDelivered, type UserText } from './transcript-user-texts'

export type Confirmation = { item: OutboxItem; patch: Pick<OutboxItem, 'state' | 'error'> }

/** What the transcript says about one session's sent messages; anything it can't settle waits. */
export function confirmSent(
  items: OutboxItem[],
  records: UserText[],
  session: LiveSession | null,
  now: number,
  timing: Pick<typeof DEFAULT_OUTBOX_TIMING, 'goneGraceMs' | 'resumeConfirmMs'>
): Confirmation[] {
  const delivered = matchDelivered(items, records)
  const out: Confirmation[] = []
  for (const item of items) {
    if (delivered.has(item)) {
      out.push({ item, patch: { state: 'delivered', error: null } })
      continue
    }
    const since = now - (item.sentAt ?? now)
    if (item.route === 'resume') {
      if (since > timing.resumeConfirmMs) {
        out.push({
          item,
          patch: {
            state: 'failed',
            error: 'The session was resumed, but its transcript never showed the message'
          }
        })
      }
    } else if (item.route === 'codex-queue') {
      // Codex keeps it queued with the thread; it is delivered whenever the session runs again.
      continue
    } else if ((!session || !session.alive) && since > timing.goneGraceMs) {
      out.push({
        item,
        patch: { state: 'failed', error: 'The session closed before it read the message' }
      })
    }
  }
  return out
}

/** Typed but unconfirmed messages, per session, oldest first. */
export function sentBySession(items: Iterable<OutboxItem>): Map<string, OutboxItem[]> {
  const bySession = new Map<string, OutboxItem[]>()
  for (const item of items) {
    if (item.state === 'sent') {
      bySession.set(item.sessionId, [...(bySession.get(item.sessionId) ?? []), item])
    }
  }
  for (const list of bySession.values()) {
    list.sort((a, b) => a.createdAt - b.createdAt)
  }
  return bySession
}
