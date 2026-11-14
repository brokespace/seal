import * as z from 'zod'
import type {
  HomeChat,
  HomeChatAccountOption,
  HomeChatEntry,
  HomeChatEvent,
  HomeChatSummary
} from '../../../../src/shared/home-chat/home-chat-types'
import { salvagingArray } from '../../../../src/shared/zod-salvage'

const entryBase = { id: z.string().min(1), rev: z.number(), at: z.number(), ord: z.number() }

export const homeChatEntrySchema: z.ZodType<HomeChatEntry> = z.discriminatedUnion('kind', [
  z.object({
    ...entryBase,
    kind: z.literal('user'),
    text: z.string(),
    delivery: z.enum(['sending', 'delivered', 'failed'])
  }),
  z.object({
    ...entryBase,
    kind: z.literal('assistant'),
    text: z.string(),
    streaming: z.boolean()
  }),
  z.object({
    ...entryBase,
    kind: z.literal('thinking'),
    text: z.string(),
    streaming: z.boolean(),
    durationMs: z.number().optional()
  }),
  z.object({
    ...entryBase,
    kind: z.literal('tool'),
    tool: z.string(),
    input: z.record(z.string(), z.unknown()),
    machine: z.string().optional(),
    status: z.enum(['awaiting-approval', 'running', 'ok', 'error', 'denied']),
    output: z.string().optional(),
    durationMs: z.number().optional(),
    approvalReason: z.string().optional()
  }),
  z.object({ ...entryBase, kind: z.literal('progress'), text: z.string() }),
  z.object({
    ...entryBase,
    kind: z.literal('compaction'),
    summary: z.string(),
    auto: z.boolean()
  }),
  z.object({ ...entryBase, kind: z.literal('error'), text: z.string() }),
  z.object({
    ...entryBase,
    kind: z.literal('notice'),
    source: z.enum(['job', 'subagent', 'routine', 'approval']),
    text: z.string()
  }),
  z.object({
    ...entryBase,
    kind: z.literal('attachment'),
    attachmentId: z.string().min(1),
    name: z.string(),
    mimeType: z.string(),
    size: z.number(),
    machine: z.string().optional()
  })
])

const summaryShape = {
  id: z.string().min(1),
  title: z.string(),
  parentChatId: z.string().optional(),
  backend: z.enum(['claude-code', 'codex', 'openai-compatible']),
  accountId: z.string().nullable(),
  model: z.string().nullable(),
  status: z.enum(['idle', 'running', 'error']),
  createdAt: z.number(),
  updatedAt: z.number(),
  context: z.object({
    usedTokens: z.number(),
    windowTokens: z.number(),
    compactions: z.number()
  }),
  lastMachine: z.string().nullable()
}

export const homeChatSummarySchema: z.ZodType<HomeChatSummary> = z.object(summaryShape)

// A newer host may add entry kinds; drop those rows instead of the whole conversation.
export const homeChatSchema: z.ZodType<HomeChat> = z.object({
  ...summaryShape,
  entries: salvagingArray(homeChatEntrySchema)
})

export const homeChatSummaryListSchema = salvagingArray(homeChatSummarySchema)

export const homeChatAccountOptionSchema: z.ZodType<HomeChatAccountOption> = z.object({
  backend: z.enum(['claude-code', 'codex']),
  id: z.string().nullable(),
  label: z.string(),
  detail: z.string().optional()
})

const homeChatEventSchema: z.ZodType<HomeChatEvent> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('entry'), chatId: z.string(), entry: homeChatEntrySchema }),
  z.object({ type: z.literal('summary'), chat: homeChatSummarySchema }),
  z.object({ type: z.literal('deleted'), chatId: z.string() }),
  z.object({ type: z.literal('memory') }),
  z.object({
    type: z.literal('open'),
    target: z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('view'),
        view: z.enum([
          'home',
          'machines',
          'sessions',
          'tasks',
          'activity',
          'automations',
          'skills',
          'settings'
        ])
      }),
      z.object({ kind: z.literal('thread'), chatId: z.string() }),
      z.object({ kind: z.literal('machine'), machineId: z.string() }),
      z.object({ kind: z.literal('take-over'), sessionId: z.string() })
    ])
  })
])

export const homeChatWatchFrameSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ready'),
    subscriptionId: z.string().min(1),
    chats: homeChatSummaryListSchema
  }),
  z.object({ type: z.literal('event'), event: homeChatEventSchema }),
  z.object({ type: z.literal('end') }),
  z.object({ type: z.literal('error'), error: z.unknown().optional() })
])

export type HomeChatWatchFrame = z.output<typeof homeChatWatchFrameSchema>
