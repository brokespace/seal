import { defineRpcOperation, runRpcOperation } from '../../transport/rpc/rpc-operation'
import { rpcResultVariant } from '../../transport/rpc/rpc-operation-result-reader'
import type { UnvalidatedRpcRequestPort } from '../../transport/rpc/unvalidated-rpc-request-port'
import {
  mcpApprovalAnswerSchema,
  mcpApprovalListSchema,
  type McpApproval
} from './mcp-approval-schemas'

const listApprovals = defineRpcOperation({
  name: 'seal-mcp.approvals',
  method: 'sealMcp.listApprovals',
  acceptance: 'require-result-or-throw-message',
  barrier: 'on-settle',
  read: rpcResultVariant('approvals', mcpApprovalListSchema)
})

const answerApproval = defineRpcOperation({
  name: 'seal-mcp.answer-approval',
  method: 'sealMcp.respondApproval',
  acceptance: 'require-result-or-throw-message',
  barrier: 'on-settle',
  read: rpcResultVariant('answer', mcpApprovalAnswerSchema)
})

export async function readMcpApprovals(client: UnvalidatedRpcRequestPort): Promise<McpApproval[]> {
  return (await runRpcOperation(client, listApprovals, null)).approvals
}

/** False when the call had already expired or been answered somewhere else. */
export async function answerMcpApproval(
  client: UnvalidatedRpcRequestPort,
  approvalId: string,
  approved: boolean
): Promise<boolean> {
  return (await runRpcOperation(client, answerApproval, { approvalId, approved })).settled
}
