// What a paired server's transcript methods send, read defensively: it crosses a trust boundary.
import * as z from 'zod'
import type {
  LiveTranscriptCursor,
  LiveTranscriptDelta,
  LiveTranscriptPage
} from '../../../shared/live-sessions/live-session-types'
import {
  NATIVE_CHAT_ROLES,
  type NativeChatMessage
} from '../../../shared/native-chat/native-chat-types'
import { salvagingArray } from '../../../shared/zod-salvage'
import { readFromServer } from './federated-watch-frames'

const Cursor = z.number().int().nonnegative()

/** What every reader of a row relies on; the rest is the server's own decoder's output. */
const rowShape = z.looseObject({
  id: z.string().min(1),
  role: z.enum(NATIVE_CHAT_ROLES),
  blocks: z.array(z.looseObject({ type: z.string() })),
  timestamp: z.number().nullable(),
  source: z.string()
})

const messagesSchema = salvagingArray(
  z.custom<NativeChatMessage>((value) => rowShape.safeParse(value).success)
)

const pageSchema = z.object({
  sessionId: z.string(),
  messages: messagesSchema,
  cursor: Cursor,
  start: Cursor,
  more: z.boolean()
})

const deltaSchema = z.object({
  sessionId: z.string(),
  from: Cursor,
  cursor: Cursor,
  messages: messagesSchema,
  reset: z.literal(true).optional()
})

const sinceSchema = z.object({ messages: messagesSchema, cursor: Cursor, shrank: z.boolean() })

const frameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), page: pageSchema.nullable() }),
  z.object({ type: z.literal('delta'), delta: deltaSchema }),
  z.object({ type: z.literal('end') })
])

export type ServerTranscriptSince = {
  messages: NativeChatMessage[]
  cursor: LiveTranscriptCursor
  shrank: boolean
}

export type ServerTranscriptFrame =
  | { type: 'ready'; page: LiveTranscriptPage | null }
  | { type: 'delta'; delta: LiveTranscriptDelta }
  | { type: 'end' }

export const readTranscriptPage = (value: unknown): LiveTranscriptPage | null =>
  readFromServer(pageSchema, value)
export const readTranscriptSince = (value: unknown): ServerTranscriptSince | null =>
  readFromServer(sinceSchema, value)
export const readTranscriptFrame = (value: unknown): ServerTranscriptFrame | null =>
  readFromServer(frameSchema, value)
