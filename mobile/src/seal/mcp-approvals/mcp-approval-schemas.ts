import * as z from 'zod'
import { salvagingArray } from '../../../../src/shared/zod-salvage'

/** An MCP call waiting for a person, as the host's `SealMcpApprovalRequest` describes it. */
export const mcpApprovalSchema = z.looseObject({
  id: z.string().min(1),
  clientName: z.string(),
  transport: z.string(),
  tool: z.string(),
  machine: z.string().nullable(),
  summary: z.string(),
  reason: z.string(),
  requestedAt: z.number().finite(),
  expiresAt: z.number().finite()
})

export type McpApproval = z.output<typeof mcpApprovalSchema>

export const mcpApprovalListSchema = z.looseObject({
  approvals: salvagingArray(mcpApprovalSchema)
})

export const mcpApprovalAnswerSchema = z.looseObject({ settled: z.boolean() })

const eventSchema = z.discriminatedUnion('type', [
  z.looseObject({ type: z.literal('approval-requested'), request: mcpApprovalSchema }),
  z.looseObject({ type: z.literal('approval-settled'), id: z.string().min(1) })
])

export const mcpApprovalsWatchFrameSchema = z.discriminatedUnion('type', [
  z.looseObject({ type: z.literal('ready'), approvals: salvagingArray(mcpApprovalSchema) }),
  z.looseObject({ type: z.literal('event'), event: eventSchema }),
  z.looseObject({ type: z.literal('error'), message: z.string().optional() }),
  z.looseObject({ type: z.literal('end') })
])
