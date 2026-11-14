import * as z from 'zod'
import { SEAL_MCP_APPROVAL_POLICIES, SEAL_MCP_SCOPES } from '../seal-mcp/seal-mcp-types'

const ClientId = z.string().min(1).max(64)

export const SealMcpSettingsUpdateParams = z
  .object({ httpEnabled: z.boolean().optional(), relayEnabled: z.boolean().optional() })
  .strict()

export const SealMcpClientCreateParams = z
  .object({
    name: z.string().trim().min(1).max(80),
    scopes: z.array(z.enum(SEAL_MCP_SCOPES)).min(1),
    machines: z.array(z.string().min(1).max(200)).min(1).max(200).nullable().optional(),
    approval: z.enum(SEAL_MCP_APPROVAL_POLICIES).optional(),
    allowRelay: z.boolean().optional(),
    callsPerMinute: z.number().int().min(1).max(6000).optional()
  })
  .strict()

export const SealMcpClientIdParams = z.object({ clientId: ClientId }).strict()

export const SealMcpAuditListParams = z
  .object({
    clientId: ClientId.optional(),
    limit: z.number().int().min(1).max(1000).optional(),
    before: z.number().optional()
  })
  .strict()
  .nullish()

export const SealMcpApprovalRespondParams = z
  .object({ approvalId: z.string().min(1).max(64), approved: z.boolean() })
  .strict()

export const SealMcpUnwatchParams = z.object({ subscriptionId: z.string().min(1) }).strict()

/** One JSON-RPC message from an MCP client that reaches this server through `seal mcp`. */
export const SealMcpMessageParams = z
  .object({
    token: z.string().min(1).max(200),
    message: z.record(z.string(), z.unknown())
  })
  .strict()

export type SealMcpMessageResult = { reply: Record<string, unknown> | null }
