import * as z from 'zod'

const ChatId = z.string().min(1).max(200)
const Backend = z.enum(['claude-code', 'codex', 'openai-compatible'])

export const HomeChatIdParams = z.object({ chatId: ChatId }).strict()

export const HomeChatCreateParams = z
  .object({
    backend: Backend.optional(),
    accountId: z.string().min(1).nullable().optional(),
    model: z.string().min(1).nullable().optional()
  })
  .strict()
  .nullish()

export const HomeChatUpdateParams = z
  .object({
    chatId: ChatId,
    title: z.string().trim().min(1).max(200).optional(),
    backend: Backend.optional(),
    accountId: z.string().min(1).nullable().optional(),
    model: z.string().min(1).nullable().optional()
  })
  .strict()

export const HomeChatSendParams = z
  .object({ chatId: ChatId, text: z.string().trim().min(1).max(100_000) })
  .strict()

export const HomeChatRespondApprovalParams = z
  .object({ chatId: ChatId, entryId: z.string().min(1), approved: z.boolean() })
  .strict()

export const HomeChatAttachmentParams = z
  .object({ chatId: ChatId, attachmentId: z.string().min(1) })
  .strict()

/** Moves a phone upload into the chat's upload folder so the assistant can open it by path. */
export const HomeChatAttachUploadParams = z
  .object({ chatId: ChatId, uploadId: z.string().min(1) })
  .strict()

export const HomeChatUnwatchParams = z.object({ subscriptionId: z.string().min(1) }).strict()

export type HomeChatAttachUploadResult = { path: string; name: string; size: number }
