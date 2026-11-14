import {
  SealMcpApprovalRespondParams,
  SealMcpAuditListParams,
  SealMcpClientCreateParams,
  SealMcpClientIdParams,
  SealMcpMessageParams,
  SealMcpSettingsUpdateParams,
  SealMcpUnwatchParams,
  type SealMcpMessageResult
} from '../../../../../shared/rpc-contract/seal-mcp-params'
import { requireSealMcpService as mcp } from '../../../../seal-mcp/seal-mcp-service-instance'
import { defineMethod, defineStreamingMethod, type RpcContext } from '../../core'
import { holdSubscription } from '../rpc-subscription-hold'

/** Who carried a `seal mcp` message here: this machine's own CLI, or a paired device's. */
function stdioPeer(ctx: RpcContext): { transport: 'stdio'; remote: string } {
  return {
    transport: 'stdio',
    remote: ctx.caller?.kind === 'paired-device' ? `device:${ctx.caller.deviceId}` : 'local'
  }
}

// Minting a client token hands out standing access to this host, so managing them is host-admin.
export const SEAL_MCP_METHODS = [
  defineMethod({
    name: 'sealMcp.status',
    permission: 'host-admin',
    params: null,
    handler: () => ({
      status: mcp().status(),
      clients: mcp().listClients(),
      approvals: mcp().listApprovals()
    })
  }),
  defineMethod({
    name: 'sealMcp.updateSettings',
    permission: 'host-admin',
    params: SealMcpSettingsUpdateParams,
    handler: (patch) => ({ settings: mcp().updateSettings(patch) })
  }),
  defineMethod({
    name: 'sealMcp.createClient',
    permission: 'host-admin',
    params: SealMcpClientCreateParams,
    handler: (args) => mcp().createClient(args)
  }),
  defineMethod({
    name: 'sealMcp.revokeClient',
    permission: 'host-admin',
    params: SealMcpClientIdParams,
    handler: ({ clientId }) => ({ revoked: mcp().revokeClient(clientId) })
  }),
  defineMethod({
    name: 'sealMcp.removeClient',
    permission: 'host-admin',
    params: SealMcpClientIdParams,
    handler: ({ clientId }) => ({ removed: mcp().removeClient(clientId) })
  }),
  defineMethod({
    name: 'sealMcp.listMachines',
    permission: 'host-admin',
    params: null,
    handler: async () => ({ machines: await mcp().listMachines() })
  }),
  defineMethod({
    name: 'sealMcp.listAudit',
    permission: 'host-admin',
    params: SealMcpAuditListParams,
    handler: (query) => ({ entries: mcp().listAudit(query ?? {}) })
  }),
  defineMethod({
    name: 'sealMcp.listApprovals',
    permission: 'host-admin',
    params: null,
    handler: () => ({ approvals: mcp().listApprovals() })
  }),
  defineMethod({
    name: 'sealMcp.respondApproval',
    permission: 'host-admin',
    params: SealMcpApprovalRespondParams,
    handler: ({ approvalId, approved }) => ({
      settled: mcp().respondApproval(approvalId, approved)
    })
  }),
  // Pending approvals first, then every change: clients, settings, audit entries, approvals.
  defineStreamingMethod({
    name: 'sealMcp.watch',
    permission: 'host-admin',
    params: null,
    handler: async (_params, ctx, emit) => {
      const service = mcp()
      await holdSubscription('seal-mcp', ctx, emit, (subscriptionId) => {
        const off = service.onEvent((event) => emit({ type: 'event', event }))
        emit({ type: 'ready', subscriptionId, approvals: service.listApprovals() })
        return off
      })
    }
  }),
  // What a paired phone may watch: calls waiting for a person, and nothing about clients or the log.
  defineStreamingMethod({
    name: 'sealMcp.watchApprovals',
    permission: 'host-admin',
    params: null,
    handler: async (_params, ctx, emit) => {
      const service = mcp()
      await holdSubscription('seal-mcp-approvals', ctx, emit, (subscriptionId) => {
        const off = service.onEvent((event) => {
          if (event.type === 'approval-requested' || event.type === 'approval-settled') {
            emit({ type: 'event', event })
          }
        })
        emit({ type: 'ready', subscriptionId, approvals: service.listApprovals() })
        return off
      })
    }
  }),
  defineMethod({
    name: 'sealMcp.unwatch',
    permission: 'host-admin',
    params: SealMcpUnwatchParams,
    handler: ({ subscriptionId }, { runtime }) => {
      runtime.cleanupSubscription(subscriptionId)
      return { unsubscribed: true }
    }
  }),
  // `seal mcp` pipes an MCP client's stdio here. The client token, not the caller, sets what it may do.
  defineMethod({
    name: 'sealMcp.message',
    permission: 'workspace',
    params: SealMcpMessageParams,
    handler: async ({ token, message }, ctx): Promise<SealMcpMessageResult> => {
      const peer = stdioPeer(ctx)
      const admission = mcp().admit(token, peer)
      if (!admission.ok) {
        throw new Error(
          admission.reason === 'throttled'
            ? `Too many failed sign-ins. Try again in ${admission.retryAfterSeconds} seconds.`
            : 'That MCP client token is not valid, or it was revoked.'
        )
      }
      return { reply: await mcp().handle(admission.client, peer, message, ctx.signal) }
    }
  })
] as const
