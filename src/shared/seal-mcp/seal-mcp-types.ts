/** What an MCP client may do. A tool needs every scope it lists; nothing is allowed without one. */
export const SEAL_MCP_SCOPES = ['read', 'sessions', 'files', 'commands', 'destructive'] as const
export type SealMcpScope = (typeof SEAL_MCP_SCOPES)[number]

export function isSealMcpScope(value: unknown): value is SealMcpScope {
  return typeof value === 'string' && SEAL_MCP_SCOPES.some((scope) => scope === value)
}

/** When a call waits for a person to approve it in the Seal app. */
export const SEAL_MCP_APPROVAL_POLICIES = ['never', 'destructive', 'commands'] as const
export type SealMcpApprovalPolicy = (typeof SEAL_MCP_APPROVAL_POLICIES)[number]

export function isSealMcpApprovalPolicy(value: unknown): value is SealMcpApprovalPolicy {
  return typeof value === 'string' && SEAL_MCP_APPROVAL_POLICIES.some((policy) => policy === value)
}

/** How a request reached this Seal server. */
export type SealMcpTransport = 'stdio' | 'http' | 'relay'

/** A client as Settings shows it. The token itself is never stored or returned again. */
export type SealMcpClient = {
  id: string
  name: string
  scopes: SealMcpScope[]
  /** Machine ids this client may act on; null means every machine. */
  machines: string[] | null
  approval: SealMcpApprovalPolicy
  /** May connect through the Seal relay, which can read what passes through it. */
  allowRelay: boolean
  /** Calls per minute before the client is told to slow down. */
  callsPerMinute: number
  createdAt: number
  lastUsedAt: number | null
  revokedAt: number | null
}

export type SealMcpClientCreateArgs = {
  name: string
  scopes: SealMcpScope[]
  machines?: string[] | null
  approval?: SealMcpApprovalPolicy
  allowRelay?: boolean
  callsPerMinute?: number
}

/** A machine a client can be limited to, as the `list_machines` tool names it. */
export type SealMcpMachine = { id: string; label: string }

/** The only moment the full token exists outside the client that holds it. */
export type SealMcpClientCreated = { client: SealMcpClient; token: string }

export type SealMcpAuditOutcome =
  | 'ok'
  | 'error'
  | 'unauthorized'
  | 'scope-denied'
  | 'machine-denied'
  | 'approval-denied'
  | 'rate-limited'

export type SealMcpAuditEntry = {
  id: string
  at: number
  /** Null when the caller presented no valid token. */
  clientId: string | null
  clientName: string | null
  transport: SealMcpTransport
  /** The peer address as this server saw it, or as the relay reported it. */
  remote: string | null
  /** JSON-RPC method, e.g. `tools/call`. */
  method: string
  tool: string | null
  machine: string | null
  /** The arguments with secrets and file contents removed. */
  summary: string | null
  outcome: SealMcpAuditOutcome
  approved: boolean | null
  durationMs: number
  detail: string | null
}

export type SealMcpApprovalRequest = {
  id: string
  clientId: string
  clientName: string
  transport: SealMcpTransport
  tool: string
  machine: string | null
  summary: string
  reason: string
  requestedAt: number
  expiresAt: number
}

export type SealMcpSettings = {
  /** Serve `/mcp` on the Seal server's own port. */
  httpEnabled: boolean
  /** Accept requests the Seal relay forwards. */
  relayEnabled: boolean
}

export type SealMcpStatus = {
  settings: SealMcpSettings
  /** `http://<address>:<port>/mcp` for each address this server listens on. */
  httpUrls: string[]
  /** The public relay URL, or null when this server has no relay identity yet. */
  relayUrl: string | null
  relayConnected: boolean
  toolCount: number
}

export type SealMcpEvent =
  | { type: 'clients' }
  | { type: 'settings' }
  /** Where the server is reachable changed, e.g. the relay tunnel connected or dropped. */
  | { type: 'status' }
  | { type: 'audit'; entry: SealMcpAuditEntry }
  | { type: 'approval-requested'; request: SealMcpApprovalRequest }
  | { type: 'approval-settled'; id: string }
