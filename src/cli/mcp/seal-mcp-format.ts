import type {
  SealMcpApprovalRequest,
  SealMcpAuditEntry,
  SealMcpClient,
  SealMcpStatus
} from '../../shared/seal-mcp/seal-mcp-types'

export function formatSealMcpStatus(status: SealMcpStatus): string {
  const http = status.settings.httpEnabled
    ? status.httpUrls.length > 0
      ? status.httpUrls.join(', ')
      : 'on, but this server has no network listener'
    : 'off'
  const relay = status.settings.relayEnabled
    ? `${status.relayUrl ?? 'no relay identity yet (pair a device first)'} (${status.relayConnected ? 'connected' : 'not connected'})`
    : 'off'
  return [`http: ${http}`, `relay: ${relay}`, `tools: ${status.toolCount}`].join('\n')
}

export function formatSealMcpClients(clients: SealMcpClient[]): string {
  if (clients.length === 0) {
    return 'No MCP clients. Create one with `seal mcp token create --name <name> --scopes read`.'
  }
  return clients
    .map((client) =>
      [
        `${client.id}  ${client.name}${client.revokedAt === null ? '' : '  (revoked)'}`,
        `  scopes: ${client.scopes.join(', ')}`,
        `  machines: ${client.machines ? client.machines.join(', ') : 'all'}`,
        `  approval: ${client.approval}  relay: ${client.allowRelay ? 'allowed' : 'not allowed'}  rate: ${client.callsPerMinute}/min`,
        `  last used: ${client.lastUsedAt === null ? 'never' : new Date(client.lastUsedAt).toISOString()}`
      ].join('\n')
    )
    .join('\n')
}

export function formatSealMcpAudit(entries: SealMcpAuditEntry[]): string {
  if (entries.length === 0) {
    return 'No MCP calls recorded.'
  }
  return entries
    .map((entry) =>
      [
        new Date(entry.at).toISOString(),
        entry.clientName ?? '(no valid token)',
        entry.transport,
        entry.tool ?? entry.method,
        entry.machine ?? '-',
        entry.outcome,
        entry.summary ?? entry.detail ?? ''
      ]
        .join('  ')
        .trimEnd()
    )
    .join('\n')
}

export function formatSealMcpApprovals(approvals: SealMcpApprovalRequest[]): string {
  if (approvals.length === 0) {
    return 'Nothing is waiting for approval.'
  }
  return approvals
    .map(
      (approval) =>
        `${approval.id}  ${approval.clientName} (${approval.transport})  ${approval.tool}${approval.machine ? ` on ${approval.machine}` : ''}\n  ${approval.summary}\n  ${approval.reason}`
    )
    .join('\n')
}
