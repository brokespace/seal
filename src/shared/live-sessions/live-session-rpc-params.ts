import * as z from 'zod'

const SessionId = z.string().min(1).max(4096)
const Cursor = z.number().int().nonnegative()

export const LiveSessionTranscriptParams = z.object({
  sessionId: SessionId,
  before: Cursor.nullish(),
  limit: z.number().int().min(1).max(500).optional()
})

export const LiveSessionWatchTranscriptParams = z.object({
  sessionId: SessionId,
  fromCursor: Cursor.nullish()
})

export const LiveSessionSendParams = z.object({
  sessionId: SessionId,
  messageId: z.string().min(1).max(128),
  text: z.string().min(1).max(100_000)
})

export const LiveSessionRetryParams = z.object({ messageId: z.string().min(1).max(128) })

export const LiveSessionMessagesParams = z.object({ sessionId: SessionId.optional() })

export const LiveSessionAnswerParams = z.object({
  sessionId: SessionId,
  promptId: z.string().min(1).max(256),
  optionId: z.string().min(1).max(64)
})

export const LiveSessionUnwatchParams = z.object({ subscriptionId: z.string().min(1).max(256) })

export const LiveSessionTakeOverParams = z.object({ sessionId: SessionId })

export const LiveSessionHostRunParams = z.object({
  script: z
    .string()
    .min(1)
    .max(256 * 1024),
  timeoutMs: z.number().int().min(1_000).max(120_000).optional()
})

export const LiveSessionRemoveParams = z.object({
  sessionIds: z.array(SessionId).min(1).max(500),
  stop: z.boolean(),
  deleteTranscripts: z.boolean()
})
