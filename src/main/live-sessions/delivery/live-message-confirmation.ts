import type { LiveSession } from '../../../shared/live-sessions/live-session-types'
import { isRestingLiveSessionStatus } from '../../../shared/live-sessions/live-session-status'
import type { DEFAULT_OUTBOX_TIMING, OutboxItem } from './live-message-outbox-types'
import { matchDelivered, type UserText } from './transcript-user-texts'

export type Confirmation = {
  item: OutboxItem
  patch: Pick<OutboxItem, 'state' | 'error' | 'unconfirmed' | 'echoOffset'>
}

/** The session was handed the message and never showed it: it may have run it all the same. */
const unconfirmed = (why: string): Confirmation['patch'] => ({
  state: 'failed',
  error: `Not confirmed, it may have been delivered: ${why}`,
  unconfirmed: true
})

/**
 * What the transcript says about one session's sent messages; anything it can't settle waits.
 * `restingSince` is when the session was first seen at its prompt with nothing running, and
 * null while it is not: a working agent keeps what is typed in its own queue. A session missing
 * from a machine not read since Seal started (`machineRead` false) may still be running.
 */
export function confirmSent(
  items: OutboxItem[],
  records: UserText[],
  session: LiveSession | null,
  now: number,
  timing: Pick<
    typeof DEFAULT_OUTBOX_TIMING,
    'goneGraceMs' | 'resumeConfirmMs' | 'unreadAfterMs' | 'orderHoldMs'
  >,
  restingSince: number | null = null,
  machineRead = true
): Confirmation[] {
  const delivered = matchDelivered(items, records)
  const out: Confirmation[] = []
  for (const item of items) {
    if (delivered.has(item)) {
      out.push({
        item,
        patch: {
          state: 'delivered',
          error: null,
          unconfirmed: undefined,
          echoOffset: delivered.get(item)
        }
      })
      continue
    }
    // Already given up as unconfirmed: only its transcript changes that.
    if (item.state === 'failed') {
      continue
    }
    const since = now - (item.sentAt ?? now)
    // Nothing says what became of it until its machine is read; the order hold ends that wait.
    if (!session && !machineRead && since <= timing.orderHoldMs) {
      continue
    }
    if (item.route === 'resume') {
      if (since > timing.resumeConfirmMs) {
        out.push({
          item,
          patch: unconfirmed('the session was resumed, but its transcript never showed it')
        })
      }
    } else if (item.route === 'structured') {
      // The chat's host took it and starts the agent if it rests: a process says nothing here.
      if (since > timing.resumeConfirmMs) {
        out.push({
          item,
          patch: unconfirmed('the chat took it, but its history never showed it')
        })
      }
    } else if (item.route === 'codex-queue') {
      // Codex keeps it queued with the thread; it is delivered whenever the session runs again.
      continue
    } else if ((!session || !session.alive) && since > timing.goneGraceMs) {
      out.push({ item, patch: unconfirmed('the session closed before showing it') })
    } else if (
      restingSince !== null &&
      now - Math.max(restingSince, item.sentAt ?? now) > timing.unreadAfterMs
    ) {
      out.push({ item, patch: unconfirmed('Seal typed it, but the session never showed it') })
    }
  }
  return out
}

/**
 * Sent messages awaiting their transcript, per session, oldest first. One given up as unconfirmed
 * is looked for again while its session has another to confirm.
 */
export function sentBySession(items: Iterable<OutboxItem>): Map<string, OutboxItem[]> {
  const bySession = new Map<string, OutboxItem[]>()
  const all = [...items]
  for (const item of all) {
    if (item.state === 'sent') {
      bySession.set(item.sessionId, [...(bySession.get(item.sessionId) ?? []), item])
    }
  }
  for (const item of all) {
    if (item.state === 'failed' && item.unconfirmed) {
      bySession.get(item.sessionId)?.push(item)
    }
  }
  for (const list of bySession.values()) {
    list.sort((a, b) => a.createdAt - b.createdAt)
  }
  return bySession
}

/** When each session with a typed message was first seen at its prompt with nothing running. */
export class RestingSessions {
  private readonly seen = new Map<string, number>()

  /** Null while the session is not at rest; that forgets when it last was. */
  since(sessionId: string, session: LiveSession | null, now: number): number | null {
    if (!session || !isRestingLiveSessionStatus(session.status)) {
      this.seen.delete(sessionId)
      return null
    }
    const since = this.seen.get(sessionId) ?? now
    this.seen.set(sessionId, since)
    return since
  }
}
