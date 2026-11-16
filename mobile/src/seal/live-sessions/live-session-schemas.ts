import * as z from 'zod'
import {
  LIVE_MESSAGE_STATES,
  LIVE_SESSION_STATUSES
} from '../../../../src/shared/live-sessions/live-session-types'
import {
  NATIVE_CHAT_ROLES,
  type NativeChatMessage
} from '../../../../src/shared/native-chat/native-chat-types'
import { liveSessionRecapBriefSchema } from '../../../../src/shared/session-recap/session-recap-schemas'
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

const surfaceSchema = z.discriminatedUnion('kind', [
  z.looseObject({ kind: z.literal('chat'), sessionId: z.string().min(1), tabId: z.string() }),
  z.looseObject({ kind: z.literal('cli'), paneKey: z.string().min(1) }),
  z.looseObject({ kind: z.literal('external') })
])

const capabilitiesSchema = z.looseObject({
  send: z.boolean(),
  answer: z.enum(['full', 'options', 'none']),
  transcript: z.boolean(),
  recap: z.boolean(),
  context: z.enum(['exact', 'estimated', 'none']),
  switchSurface: z.looseObject({ toChat: z.boolean(), toCli: z.boolean() }),
  takeOver: z.boolean()
})

const TokenCount = z.number().finite()

const contextSchema = z.looseObject({
  usedTokens: TokenCount,
  windowTokens: TokenCount,
  percentage: z.number().finite(),
  estimated: z.boolean(),
  rows: salvagingArray(
    z.looseObject({
      name: z.string(),
      tokens: TokenCount,
      percentage: z.number().finite(),
      deferred: z.literal(true).optional()
    })
  ),
  autoCompactAtTokens: TokenCount.optional().catch(undefined),
  model: z.string().optional().catch(undefined),
  compactions: z.number().finite().optional().catch(undefined),
  lastCompactedAt: Timestamp.optional().catch(undefined),
  updatedAt: Timestamp.optional().catch(undefined)
})

const liveSessionSchema = z.looseObject({
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
  permission: permissionSchema.nullable(),
  // The host's one-sentence summary; absent on hosts without a utility model.
  summary: z.string().optional().catch(undefined),
  summaryPending: z.boolean().optional().catch(undefined),
  // The name set in Seal, and whether `title` is one set in the agent: both outrank the recap's title.
  customTitle: z.string().nullish().catch(undefined),
  titleNamed: z.boolean().optional().catch(undefined),
  recap: liveSessionRecapBriefSchema.optional().catch(undefined),
  // Absent on hosts whose registry predates them; a shape this build can't read is dropped, not fatal.
  surface: surfaceSchema.optional().catch(undefined),
  capabilities: capabilitiesSchema.optional().catch(undefined),
  workspace: z
    .looseObject({ worktreeId: z.string().min(1), projectKey: z.string() })
    .optional()
    .catch(undefined),
  context: contextSchema.optional().catch(undefined),
  model: z.string().optional().catch(undefined)
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
  /** The session may have run it without a sign: the host sends it again only when told it may run twice. */
  unconfirmed: z.literal(true).optional().catch(undefined),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  /** Where it was written and where the transcript holds it; a host from before them sends neither. */
  sentOffset: z.number().nullish().catch(undefined),
  echoOffset: z.number().nullish().catch(undefined)
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

const transcriptRowSchema = z.looseObject({
  id: z.string().min(1),
  role: z.enum(NATIVE_CHAT_ROLES),
  blocks: z.array(z.looseObject({ type: z.string() })),
  timestamp: Timestamp.nullish(),
  transcriptOffset: z.number().optional()
})

// The registry sends the chat view's own rows: only what orders and places one is checked here.
const liveTranscriptMessageSchema = z.custom<NativeChatMessage>(
  (row) => transcriptRowSchema.safeParse(row).success
)

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
export type LiveTranscriptPage = z.output<typeof liveTranscriptPageSchema>
export type LiveTranscriptDelta = z.output<typeof liveTranscriptDeltaSchema>
export type LiveTakeOverResult = z.output<typeof liveTakeOverResultSchema>
