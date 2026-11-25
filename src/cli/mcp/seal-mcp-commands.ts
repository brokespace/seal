import {
  isSealMcpApprovalPolicy,
  isSealMcpScope,
  SEAL_MCP_APPROVAL_POLICIES,
  SEAL_MCP_SCOPES,
  type SealMcpApprovalRequest,
  type SealMcpAuditEntry,
  type SealMcpClient,
  type SealMcpClientCreated,
  type SealMcpMachine,
  type SealMcpSettings,
  type SealMcpStatus
} from '../../shared/seal-mcp/seal-mcp-types'
import {
  getOptionalPositiveIntegerFlag,
  getOptionalStringFlag,
  getRequiredStringFlag
} from '../arguments/flags'
import type { CommandHandler, HandlerContext } from '../dispatch/dispatch'
import { printResult } from '../output/command-result-output'
import { RuntimeClientError } from '../runtime/types'
import {
  formatSealMcpApprovals,
  formatSealMcpAudit,
  formatSealMcpClients,
  formatSealMcpStatus
} from './seal-mcp-format'
import { runSealMcpStdioBridge, SEAL_MCP_TOOL_CALL_TIMEOUT_MS } from './seal-mcp-stdio-bridge'

export const SEAL_MCP_TOKEN_ENV = 'SEAL_MCP_TOKEN'

type StatusResult = {
  status: SealMcpStatus
  clients: SealMcpClient[]
  approvals: SealMcpApprovalRequest[]
}

function commaList(ctx: HandlerContext, name: string): string[] | undefined {
  const value = getOptionalStringFlag(ctx.flags, name)
  return value
    ?.split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function transportSetting(ctx: HandlerContext): keyof SealMcpSettings {
  const transport = getRequiredStringFlag(ctx.flags, 'transport')
  if (transport !== 'http' && transport !== 'relay') {
    throw new RuntimeClientError('invalid_argument', 'Name the transport: http or relay.')
  }
  return transport === 'http' ? 'httpEnabled' : 'relayEnabled'
}

async function setTransport(ctx: HandlerContext, enabled: boolean): Promise<void> {
  await ctx.client.call('sealMcp.updateSettings', { [transportSetting(ctx)]: enabled })
  const response = await ctx.client.call<StatusResult>('sealMcp.status')
  printResult(response, ctx.json, ({ status }) => formatSealMcpStatus(status))
}

async function respond(ctx: HandlerContext, approved: boolean): Promise<void> {
  const response = await ctx.client.call<{ settled: boolean }>('sealMcp.respondApproval', {
    approvalId: getRequiredStringFlag(ctx.flags, 'id'),
    approved
  })
  printResult(response, ctx.json, ({ settled }) =>
    settled
      ? approved
        ? 'Approved.'
        : 'Denied.'
      : 'No such pending approval; it may have expired or been answered elsewhere.'
  )
}

type SealMcpMessageCall = (
  method: 'sealMcp.message',
  params: { token: string; message: Record<string, unknown> },
  options?: { timeoutMs: number }
) => Promise<{ result: { reply: Record<string, unknown> | null } }>

/** `seal mcp`: an MCP server on stdio. Stdout carries protocol frames only. */
export async function serveSealMcpStdio(
  call: SealMcpMessageCall,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const token = env[SEAL_MCP_TOKEN_ENV]
  if (!token) {
    throw new RuntimeClientError(
      'invalid_argument',
      `Set ${SEAL_MCP_TOKEN_ENV} to a client token. Create one in Seal Settings → MCP, or with \`seal mcp token create\`.`
    )
  }
  await runSealMcpStdioBridge({
    input: process.stdin,
    output: process.stdout,
    log: (line) => process.stderr.write(`${line}\n`),
    send: async (message) => {
      const response = await call(
        'sealMcp.message',
        { token, message },
        message.method === 'tools/call' ? { timeoutMs: SEAL_MCP_TOOL_CALL_TIMEOUT_MS } : undefined
      )
      return response.result.reply
    }
  })
}

export const SEAL_MCP_HANDLERS: Record<string, CommandHandler> = {
  mcp: (ctx) =>
    serveSealMcpStdio((method, params, options) => ctx.client.call(method, params, options)),
  'mcp status': async (ctx) => {
    const response = await ctx.client.call<StatusResult>('sealMcp.status')
    printResult(response, ctx.json, ({ status, clients, approvals }) =>
      [
        formatSealMcpStatus(status),
        `clients: ${clients.filter((client) => client.revokedAt === null).length} active`,
        `waiting for approval: ${approvals.length}`
      ].join('\n')
    )
  },
  'mcp enable': (ctx) => setTransport(ctx, true),
  'mcp disable': (ctx) => setTransport(ctx, false),
  'mcp token create': async (ctx) => {
    const scopes = commaList(ctx, 'scopes') ?? ['read']
    const approval = getOptionalStringFlag(ctx.flags, 'approval')
    if (!scopes.every(isSealMcpScope)) {
      throw new RuntimeClientError(
        'invalid_argument',
        `--scopes takes a comma-separated list of: ${SEAL_MCP_SCOPES.join(', ')}`
      )
    }
    if (approval !== undefined && !isSealMcpApprovalPolicy(approval)) {
      throw new RuntimeClientError(
        'invalid_argument',
        `--approval must be one of: ${SEAL_MCP_APPROVAL_POLICIES.join(', ')}`
      )
    }
    const response = await ctx.client.call<SealMcpClientCreated>('sealMcp.createClient', {
      name: getRequiredStringFlag(ctx.flags, 'name'),
      scopes,
      machines: commaList(ctx, 'machines') ?? null,
      approval,
      allowRelay: ctx.flags.get('allow-relay') === true,
      callsPerMinute: getOptionalPositiveIntegerFlag(ctx.flags, 'rate')
    })
    printResult(response, ctx.json, ({ client, token }) =>
      [
        formatSealMcpClients([client]),
        '',
        'Token (shown once; Seal keeps only its hash):',
        token
      ].join('\n')
    )
  },
  'mcp token list': async (ctx) => {
    const response = await ctx.client.call<StatusResult>('sealMcp.status')
    printResult(response, ctx.json, ({ clients }) => formatSealMcpClients(clients))
  },
  'mcp token revoke': async (ctx) => {
    const response = await ctx.client.call<{ revoked: boolean }>('sealMcp.revokeClient', {
      clientId: getRequiredStringFlag(ctx.flags, 'id')
    })
    printResult(response, ctx.json, ({ revoked }) =>
      revoked ? 'Revoked. Calls in progress were stopped.' : 'No active client with that id.'
    )
  },
  'mcp token rm': async (ctx) => {
    const response = await ctx.client.call<{ removed: boolean }>('sealMcp.removeClient', {
      clientId: getRequiredStringFlag(ctx.flags, 'id')
    })
    printResult(response, ctx.json, ({ removed }) =>
      removed ? 'Removed.' : 'No client with that id.'
    )
  },
  'mcp audit': async (ctx) => {
    const response = await ctx.client.call<{ entries: SealMcpAuditEntry[] }>('sealMcp.listAudit', {
      clientId: getOptionalStringFlag(ctx.flags, 'client'),
      limit: getOptionalPositiveIntegerFlag(ctx.flags, 'limit') ?? 50
    })
    printResult(response, ctx.json, ({ entries }) => formatSealMcpAudit(entries))
  },
  'mcp machines': async (ctx) => {
    const response = await ctx.client.call<{ machines: SealMcpMachine[] }>('sealMcp.listMachines')
    printResult(response, ctx.json, ({ machines }) =>
      machines.map((machine) => `${machine.id}\t${machine.label}`).join('\n')
    )
  },
  'mcp approvals': async (ctx) => {
    const response = await ctx.client.call<{ approvals: SealMcpApprovalRequest[] }>(
      'sealMcp.listApprovals'
    )
    printResult(response, ctx.json, ({ approvals }) => formatSealMcpApprovals(approvals))
  },
  'mcp approve': (ctx) => respond(ctx, true),
  'mcp deny': (ctx) => respond(ctx, false)
}
