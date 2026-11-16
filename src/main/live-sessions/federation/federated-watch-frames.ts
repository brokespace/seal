// What a paired server's `liveSessions.*` methods send, read defensively: it crosses a trust boundary.
import * as z from 'zod'
import { AGENT_SESSION_AGENT_IDS } from '../../../shared/live-sessions/adapters/agent-session-agent-ids'
import {
  LIVE_SUBAGENT_STATUSES,
  LIVE_TODO_STATUSES,
  type LiveSessionActivity
} from '../../../shared/live-sessions/live-session-activity'
import {
  LIVE_MESSAGE_STATES,
  LIVE_SESSION_STATUSES,
  type AgentSessionCapabilityFlags,
  type AgentSessionSurface,
  type LiveMessage,
  type LivePermissionAnswerResult,
  type LiveRemoveResult,
  type LiveSession,
  type LiveSessionInputRoute,
  type LiveSessionStatusSource
} from '../../../shared/live-sessions/live-session-types'
import type { NativeChatContextUsageSummary } from '../../../shared/native-chat/native-chat-context-usage-summary'
import { liveSessionRecapBriefSchema } from '../../../shared/session-recap/session-recap-schemas'
import { hostUnionArms, openEnum, salvagingArray } from '../../../shared/zod-salvage'

const Finite = z.number().finite()
const NullableText = z.string().nullable()

const ROUTE_KINDS = hostUnionArms<LiveSessionInputRoute['kind']>({
  structured: true,
  'seal-pane': true,
  'codex-queue': true,
  tmux: true,
  resume: true
})

const STATUS_SOURCES = hostUnionArms<LiveSessionStatusSource>({
  'seal-hooks': true,
  'agent-hooks': true,
  screen: true,
  'agent-state': true,
  process: true,
  transcript: true,
  classifier: true
})

const inputRouteSchema: z.ZodType<LiveSessionInputRoute> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('structured'), sessionId: z.string().min(1) }),
  z.object({ kind: z.literal('seal-pane'), paneKey: z.string().min(1) }),
  z.object({
    kind: z.literal('codex-queue'),
    thread: z.string(),
    binary: NullableText,
    codexHome: NullableText
  }),
  z.object({ kind: z.literal('tmux'), target: z.string(), socket: z.string().optional() }),
  z.object({ kind: z.literal('resume') })
])

const surfaceSchema: z.ZodType<AgentSessionSurface> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('chat'), sessionId: z.string().min(1), tabId: z.string() }),
  z.object({ kind: z.literal('cli'), paneKey: z.string().min(1) }),
  z.object({ kind: z.literal('external') })
])

const capabilitiesSchema: z.ZodType<AgentSessionCapabilityFlags> = z.object({
  send: z.boolean(),
  answer: z.enum(['full', 'options', 'none']),
  transcript: z.boolean(),
  recap: z.boolean(),
  context: z.enum(['exact', 'estimated', 'none']),
  switchSurface: z.object({ toChat: z.boolean(), toCli: z.boolean() }),
  takeOver: z.boolean()
})

const activitySchema: z.ZodType<LiveSessionActivity> = z.object({
  subagents: salvagingArray(
    z.object({
      id: z.string(),
      title: z.string(),
      agentType: NullableText,
      model: NullableText,
      status: z.enum(LIVE_SUBAGENT_STATUSES),
      background: z.boolean(),
      activity: NullableText,
      startedAt: Finite.nullable(),
      lastActivityAt: Finite.nullable(),
      transcriptPath: NullableText
    })
  ),
  tasks: salvagingArray(
    z.object({
      id: z.string(),
      label: z.string(),
      status: z.enum(LIVE_SUBAGENT_STATUSES),
      startedAt: Finite.nullable(),
      summary: NullableText
    })
  ),
  todos: salvagingArray(
    z.object({
      content: z.string(),
      status: z.enum(LIVE_TODO_STATUSES),
      activeForm: z.string().optional()
    })
  )
})

const contextSchema: z.ZodType<NativeChatContextUsageSummary> = z.object({
  usedTokens: Finite,
  windowTokens: Finite,
  percentage: Finite,
  estimated: z.boolean(),
  rows: salvagingArray(
    z.object({
      name: z.string(),
      tokens: Finite,
      percentage: Finite,
      deferred: z.literal(true).optional()
    })
  ),
  autoCompactAtTokens: Finite.optional(),
  model: z.string().optional(),
  compactions: Finite.optional(),
  lastCompactedAt: Finite.optional(),
  updatedAt: Finite.optional()
})

// Every LiveSession field is listed: one added to the type and not here would be dropped silently.
const serverSessionSchema = z.object({
  id: z.string().min(1),
  provider: z.enum(AGENT_SESSION_AGENT_IDS),
  providerSessionId: z.string().min(1),
  // Only its host id is read: the desktop lists the session under its own record of the server.
  machine: z.object({ hostId: z.string() }),
  origin: z.enum(['seal', 'external']),
  cwd: NullableText,
  project: NullableText,
  title: NullableText,
  status: z.enum(LIVE_SESSION_STATUSES),
  statusSource: openEnum(STATUS_SOURCES, 'transcript'),
  statusDetail: NullableText,
  lastActivityAt: Finite,
  startedAt: Finite.nullable(),
  alive: z.boolean(),
  pid: z.number().int().nullable(),
  transcriptPath: NullableText,
  inputRoutes: salvagingArray(inputRouteSchema),
  permission: z
    .object({
      promptId: z.string().min(1),
      question: z.string(),
      options: salvagingArray(z.object({ id: z.string().min(1), label: z.string() }))
    })
    .nullable(),
  activity: activitySchema.optional().catch(undefined),
  lastMessage: z.string().nullish().catch(undefined),
  customTitle: z.string().nullish().catch(undefined),
  configDir: z.string().nullish().catch(undefined),
  pinned: z.boolean().optional().catch(undefined),
  continues: z.array(z.string()).optional().catch(undefined),
  summary: z.string().optional().catch(undefined),
  summaryPending: z.literal(true).optional().catch(undefined),
  titleNamed: z.literal(true).optional().catch(undefined),
  recap: liveSessionRecapBriefSchema.optional().catch(undefined),
  // Absent from a server whose registry predates them.
  surface: surfaceSchema.optional().catch(undefined),
  capabilities: capabilitiesSchema.optional().catch(undefined),
  workspace: z
    .object({ worktreeId: z.string().min(1), projectKey: z.string() })
    .optional()
    .catch(undefined),
  context: contextSchema.optional().catch(undefined),
  model: z.string().optional().catch(undefined)
} satisfies Record<keyof LiveSession, z.ZodType>)

/** A session as its server lists it: under the server's own ids, maybe without `surface` and `capabilities`. */
export type ServerSession = z.output<typeof serverSessionSchema>

const messageSchema: z.ZodType<LiveMessage> = z.object({
  messageId: z.string().min(1),
  sessionId: z.string().min(1),
  text: z.string(),
  state: z.enum(LIVE_MESSAGE_STATES),
  route: z.enum(ROUTE_KINDS).nullable().catch(null),
  error: NullableText,
  createdAt: Finite,
  updatedAt: Finite
})

const snapshotSchema = z.object({
  // One session a newer server describes differently must not hide the rest.
  sessions: salvagingArray(serverSessionSchema),
  hostErrors: z.record(z.string(), z.string()).catch({})
})

const registryEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('snapshot'), snapshot: snapshotSchema }),
  z.object({ type: z.literal('upsert'), session: serverSessionSchema }),
  z.object({
    type: z.literal('remove'),
    sessionId: z.string().min(1),
    replacedBy: z.string().min(1).optional()
  }),
  z.object({ type: z.literal('host-error'), hostId: z.string(), error: NullableText })
])

const watchFrameSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ready'),
    // Absent from a server whose registry lists only what its scan and its Claude and Codex panes find.
    surfaces: z.array(z.string()).optional().catch(undefined),
    snapshot: snapshotSchema,
    messages: salvagingArray(messageSchema).catch([])
  }),
  z.object({ type: z.literal('event'), event: registryEventSchema }),
  z.object({ type: z.literal('message'), message: messageSchema }),
  z.object({ type: z.literal('end') })
])

export type ServerSnapshot = z.output<typeof snapshotSchema>
export type ServerRegistryEvent = z.output<typeof registryEventSchema>
export type ServerWatchFrame = z.output<typeof watchFrameSchema>

const answerResultSchema: z.ZodType<LivePermissionAnswerResult> = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({
    ok: z.literal(false),
    reason: z.enum(['prompt_not_pending', 'option_not_offered', 'not_answerable', 'failed']),
    error: z.string().optional()
  })
])

const removeResultSchema: z.ZodType<LiveRemoveResult> = z.object({
  removed: z.array(z.string()),
  failed: z.array(
    z.object({
      sessionId: z.string(),
      reason: z.enum(['still_running', 'failed']),
      error: z.string().optional()
    })
  )
})

/** `value` as the schema reads it, or null: what a server sends is dropped when malformed, never thrown on. */
export function readFromServer<T>(schema: z.ZodType<T>, value: unknown): T | null {
  try {
    const parsed = schema.safeParse(value)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export const readWatchFrame = (value: unknown): ServerWatchFrame | null =>
  readFromServer(watchFrameSchema, value)
export const readServerMessage = (value: unknown): LiveMessage | null =>
  readFromServer(messageSchema, value)
export const readAnswerResult = (value: unknown): LivePermissionAnswerResult | null =>
  readFromServer(answerResultSchema, value)
export const readRemoveResult = (value: unknown): LiveRemoveResult | null =>
  readFromServer(removeResultSchema, value)
