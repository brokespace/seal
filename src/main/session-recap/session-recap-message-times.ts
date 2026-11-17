// A recap points at messages by id, and its requests by offset too. A fork or a resume copies the
// conversation into another transcript where neither is the old one, but who said a message and
// when still is: by that, what the recap points at is found again.
import type { NativeChatMessage } from '../../shared/native-chat/native-chat-types'
import { RECAP_SECTIONS, type SessionRecap } from '../../shared/session-recap/session-recap-types'
import {
  BACKFILL_PAGE_MESSAGES,
  MAX_BACKFILL_PAGES,
  type RecapTranscript
} from './session-recap-reading'

/** Who said each message the recap points at, and when, by the message's id. */
export type RecapMessageTimes = Record<string, string>

const saidAt = (message: NativeChatMessage): string | null =>
  message.timestamp === null ? null : `${message.role} ${message.timestamp}`

function pointedAt(recap: SessionRecap): Set<string> {
  return new Set(
    [
      ...RECAP_SECTIONS.flatMap((section) => recap[section]),
      ...recap.references,
      ...(recap.requests ?? [])
    ].flatMap((item) => item.messageId ?? [])
  )
}

/** The times after a pass that read `messages` on top of what `before` already held. */
export function recapMessageTimes(
  before: RecapMessageTimes | undefined,
  messages: readonly NativeChatMessage[],
  recap: SessionRecap
): RecapMessageTimes {
  const read = new Map(messages.map((message) => [message.id, saidAt(message)]))
  const times: RecapMessageTimes = {}
  for (const id of pointedAt(recap)) {
    const time = read.get(id) ?? before?.[id]
    if (time) {
      times[id] = time
    }
  }
  return times
}

/**
 * The recap pointing at its messages where the transcript its session has now holds them. Null
 * when they all sit where they sat.
 */
export async function repointMovedRecap(
  transcript: Pick<RecapTranscript, 'page'>,
  sessionId: string,
  recap: SessionRecap,
  times: RecapMessageTimes
): Promise<{ recap: SessionRecap; times: RecapMessageTimes } | null> {
  const wanted = new Set(Object.values(times))
  const found = new Map<string, NativeChatMessage>()
  let before: number | null = null
  for (let pages = 0; pages < MAX_BACKFILL_PAGES && found.size < wanted.size; pages++) {
    const page = await transcript.page(sessionId, before, BACKFILL_PAGE_MESSAGES)
    for (const message of page.messages) {
      const time = saidAt(message)
      if (time !== null && wanted.has(time) && !found.has(time)) {
        found.set(time, message)
      }
    }
    if (!page.more || page.messages.length === 0) {
      break
    }
    before = page.start
  }
  if (Object.entries(times).every(([id, time]) => found.get(time)?.id === id)) {
    return null
  }
  const now = (id: string | null): NativeChatMessage | undefined =>
    id === null ? undefined : found.get(times[id] ?? '')
  const at = <T extends { messageId: string | null }>(item: T): T => {
    const message = now(item.messageId)
    return message ? { ...item, messageId: message.id } : item
  }
  return {
    recap: {
      ...recap,
      ...Object.fromEntries(RECAP_SECTIONS.map((section) => [section, recap[section].map(at)])),
      references: recap.references.map(at),
      ...(recap.requests
        ? {
            requests: recap.requests.map((request) => {
              if (request.messageId === null || !(request.messageId in times)) {
                return request
              }
              const message = now(request.messageId)
              // One whose message is not found is not asked about again: it stands as it stood.
              const { offset: _offset, ...kept } = request
              return message?.transcriptOffset == null
                ? kept
                : { ...kept, messageId: message.id, offset: message.transcriptOffset }
            })
          }
        : {})
    },
    times: Object.fromEntries(
      Object.values(times).flatMap((time) => {
        const message = found.get(time)
        return message ? [[message.id, time]] : []
      })
    )
  }
}
