import type {
  LiveMessage,
  LiveSendRequest,
  LiveSession,
  LiveSessionInputRoute
} from '../../../shared/live-sessions/live-session-types'
import type { RouteAttempt } from './session-input-routes'
import type { UserText } from './transcript-user-texts'

export type OutboxItem = LiveMessage & {
  /** Transcript size before it went in; its user record must come after this. */
  offset: number
  sentAt: number | null
}

export const DEFAULT_OUTBOX_TIMING = {
  /** How long a busy prompt may hold a message before it fails. */
  busyTimeoutMs: 3 * 60_000,
  busyRetryMs: 500,
  confirmEveryMs: 700,
  /** A closed session that never shows a sent message fails after this. */
  goneGraceMs: 5_000,
  /** A headless resume has this long to write the message to its transcript. */
  resumeConfirmMs: 90_000,
  /** A session at its prompt this long that still has not shown a typed message did not read it. */
  unreadAfterMs: 90_000,
  /** A sent message stops holding back the next one after this (a long tool run, a lost echo). */
  orderHoldMs: 15 * 60_000,
  /** Finished messages are remembered this long, so a resend is recognised. */
  keepFinishedMs: 72 * 60 * 60_000
}

/** A message as the outbox first holds it: in line to be sent. */
export function newOutboxItem(request: LiveSendRequest, now: number): OutboxItem {
  return {
    messageId: request.messageId,
    sessionId: request.sessionId,
    text: request.text,
    state: 'queued',
    route: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    offset: 0,
    sentAt: null
  }
}

/** A failed message put back in line: nothing of its last attempt stays. */
export const REQUEUED: Partial<OutboxItem> = {
  state: 'queued',
  error: null,
  route: null,
  sentAt: null,
  unconfirmed: undefined
}

/** What another owner of a session (a paired server) says to a message offered to it. */
export type OfferedMessage = LiveMessage | { refused: string }

export function publicView(item: OutboxItem): LiveMessage {
  const { offset: _offset, sentAt: _sentAt, ...message } = item
  return message
}

export type LiveMessageOutboxDeps = {
  storePath: string
  getSession(sessionId: string): LiveSession | null
  /** Whether the session's machine has been read since Seal started; assumed so when absent. */
  machineRead?(sessionId: string): boolean
  attempt(
    session: LiveSession,
    route: LiveSessionInputRoute,
    text: string,
    messageId: string,
    signal: AbortSignal
  ): Promise<RouteAttempt>
  /** Transcript size now (0 when it has none yet). */
  transcriptSize(session: LiveSession): Promise<number>
  /** User records from byte `from` on. */
  userTexts(session: LiveSession, from: number): Promise<UserText[]>
  onChange(message: LiveMessage): void
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  log?: (message: string, error?: unknown) => void
  timing?: Partial<typeof DEFAULT_OUTBOX_TIMING>
}

export function isOutboxItem(item: unknown): item is OutboxItem {
  return (
    typeof item === 'object' &&
    item !== null &&
    'messageId' in item &&
    typeof item.messageId === 'string' &&
    'sessionId' in item &&
    typeof item.sessionId === 'string'
  )
}

/** A message read back from disk. One being typed when Seal stopped may already be at the prompt: only the transcript can say, never a second send. */
export function restoredOutboxItem(item: OutboxItem, now: number): OutboxItem {
  if (item.state === 'sending') {
    item.state = 'sent'
    item.sentAt ??= now
  }
  return item
}
