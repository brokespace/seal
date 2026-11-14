import * as z from 'zod'
import {
  LIVE_MESSAGE_STATES,
  LIVE_SESSION_STATUSES
} from '../../../../src/shared/live-sessions/live-session-types'
import { salvagingArray } from '../../../../src/shared/zod-salvage'

const Timestamp = z.number().finite()

const inputRouteSchema = z.looseObject({
  kind: z.string().min(1),
  paneKey: z.string().optional()
})

const permissionSchema = z.looseObject({
  promptId: z.string().min(1),
  question: z.string(),
  options: salvagingArray(z.looseObject({ id: z.string().min(1), label: z.string() }))
})

export const liveSessionSchema = z.looseObject({
  id: z.string().min(1),
  // Any provider the host scans, so one added on desktop still lists here.
  provider: z.string().min(1),
  providerSessionId: z.string(),
  // `ssh`/`runtime` come from hosts that predate unified machines.
  machine: z.looseObject({
    hostId: z.string(),
    label: z.string(),
    kind: z.enum(['local', 'remote', 'ssh', 'runtime']),
    machineId: z.string().optional(),
    executionHostId: z.string().optional()
  }),
  origin: z.enum(['seal', 'external']),
  cwd: z.string().nullable(),
  project: z.string().nullable(),
  title: z.string().nullable(),
  status: z.enum(LIVE_SESSION_STATUSES),
  statusDetail: z.string().nullable(),
  lastActivityAt: Timestamp,
  startedAt: Timestamp.nullable(),
  alive: z.boolean(),
  inputRoutes: salvagingArray(inputRouteSchema),
  permission: permissionSchema.nullable()
})

export const liveSessionSnapshotSchema = z.looseObject({
  revision: z.number(),
  // One session a newer host describes differently must not hide the rest.
  sessions: salvagingArray(liveSessionSchema),
  hostErrors: z.record(z.string(), z.string())
})

export const liveMessageSchema = z.looseObject({
  messageId: z.string().min(1),
  sessionId: z.string().min(1),
  text: z.string(),
  state: z.enum(LIVE_MESSAGE_STATES),
  route: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp
})

const registryEventSchema = z.discriminatedUnion('type', [
  z.looseObject({ type: z.literal('snapshot'), snapshot: liveSessionSnapshotSchema }),
  z.looseObject({ type: z.literal('upsert'), revision: z.number(), session: liveSessionSchema }),
  z.looseObject({
    type: z.literal('remove'),
    revision: z.number(),
    sessionId: z.string(),
    replacedBy: z.string().optional()
  }),
  z.looseObject({
    type: z.literal('host-error'),
    revision: z.number(),
    hostId: z.string(),
    error: z.string().nullable()
  })
])

export const liveSessionsWatchFrameSchema = z.discriminatedUnion('type', [
  z.looseObject({
    type: z.literal('ready'),
    snapshot: liveSessionSnapshotSchema,
    messages: salvagingArray(liveMessageSchema)
  }),
  z.looseObject({ type: z.literal('event'), event: registryEventSchema }),
  z.looseObject({ type: z.literal('message'), message: liveMessageSchema }),
  z.looseObject({ type: z.literal('end') }),
  z.looseObject({ type: z.literal('error'), message: z.string().optional() })
])

// Only what the phone draws; the rest of a transcript row rides along untyped.
const transcriptBlockSchema = z.looseObject({
  type: z.string(),
  text: z.string().optional(),
  name: z.string().optional(),
  output: z.string().optional(),
  callId: z.string().optional(),
  isError: z.boolean().optional()
})

export const liveTranscriptMessageSchema = z.looseObject({
  id: z.string().min(1),
  role: z.string(),
  blocks: salvagingArray(transcriptBlockSchema),
  timestamp: Timestamp.nullable().optional(),
  transcriptOffset: z.number().optional()
})

export const liveTranscriptPageSchema = z.looseObject({
  sessionId: z.string(),
  messages: salvagingArray(liveTranscriptMessageSchema),
  cursor: z.number(),
  start: z.number(),
  more: z.boolean()
})

const liveTranscriptDeltaSchema = z.looseObject({
  sessionId: z.string(),
  from: z.number(),
  cursor: z.number(),
  messages: salvagingArray(liveTranscriptMessageSchema),
  reset: z.boolean().optional()
})

export const liveTranscriptFrameSchema = z.discriminatedUnion('type', [
  z.looseObject({ type: z.literal('ready'), page: liveTranscriptPageSchema.nullable() }),
  z.looseObject({ type: z.literal('delta'), delta: liveTranscriptDeltaSchema }),
  z.looseObject({ type: z.literal('end') }),
  z.looseObject({ type: z.literal('error'), message: z.string().optional() })
])

export const livePermissionAnswerResultSchema = z.looseObject({
  ok: z.boolean(),
  reason: z.string().optional(),
  error: z.string().optional()
})

export const liveTakeOverResultSchema = z.looseObject({
  ok: z.boolean(),
  reason: z.string().optional(),
  error: z.string().optional(),
  provider: z.string().optional(),
  providerSessionId: z.string().optional()
})

export type LiveSession = z.output<typeof liveSessionSchema>
export type LiveSessionSnapshot = z.output<typeof liveSessionSnapshotSchema>
export type LiveMessage = z.output<typeof liveMessageSchema>
export type LiveRegistryEvent = z.output<typeof registryEventSchema>
export type LiveTranscriptMessage = z.output<typeof liveTranscriptMessageSchema>
export type LiveTranscriptPage = z.output<typeof liveTranscriptPageSchema>
export type LiveTranscriptDelta = z.output<typeof liveTranscriptDeltaSchema>
export type LiveTakeOverResult = z.output<typeof liveTakeOverResultSchema>
