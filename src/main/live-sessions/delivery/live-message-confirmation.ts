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
    } else if ((!session || !session.alive) && since > timing.goneGraceMs) {
      out.push({
        item,
        patch: { state: 'failed', error: 'The session closed before it read the message' }
      })
    }
  }
  return out
}
