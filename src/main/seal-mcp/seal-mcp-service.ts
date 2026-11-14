import { join } from 'node:path'
import type {
  SealMcpApprovalRequest,
  SealMcpAuditEntry,
  SealMcpClient,
  SealMcpClientCreateArgs,
  SealMcpClientCreated,
  SealMcpEvent,
  SealMcpMachine,
  SealMcpSettings,
  SealMcpStatus
} from '../../shared/seal-mcp/seal-mcp-types'
import { SealMcpApprovals } from './approvals/seal-mcp-approvals'
import { SealMcpAuditLog, type SealMcpAuditQuery } from './audit/seal-mcp-audit-log'
import { auditDetail } from './audit/seal-mcp-audit-summary'
import { SealMcpClientStore } from './clients/seal-mcp-client-store'
import { SealMcpRateLimiter } from './limits/seal-mcp-rate-limiter'
import {
  answerMcpRequest,
  mcpError,
  mcpRequestId,
  isMcpRecord,
  type McpJsonRpcMessage
} from './protocol/mcp-json-rpc-server'
import { SealMcpAdmissionDoor, type SealMcpAdmission, type SealMcpPeer } from './seal-mcp-admission'
import { SealMcpSettingsStore } from './seal-mcp-settings-store'
import type { SealMcpToolRuntime } from './tools/seal-mcp-scoped-runtime'
import { SEAL_MCP_TOOL_NAMES, sealMcpToolListFor } from './tools/seal-mcp-tool-catalog'
import { SealMcpToolRunner, type SealMcpToolOutcome } from './tools/seal-mcp-tool-runner'

const MCP_RATE_LIMITED = -32_000

const INSTRUCTIONS =
  "Seal runs coding agents on the user's own machines. Start with list_machines; every other tool takes a machine name from it. Tools this client was not granted are not listed. Some calls wait up to two minutes for the user to approve them in the Seal app; if one is declined, do not retry or work around it."

const REVOKED: SealMcpToolOutcome = {
  text: 'This client token was revoked.',
  isError: true,
  outcome: 'unauthorized',
  machine: null,
  summary: null,
  approved: null,
  detail: 'The token was revoked during the request.'
}

export type SealMcpEndpoints = {
  httpUrls: string[]
  relayUrl: string | null
  relayConnected: boolean
}

export type SealMcpServiceOptions = {
  /** Directory for the client list, settings and audit log. */
  dir: string
  version: string
  runtime: () => Promise<SealMcpToolRuntime>
  approvalTimeoutMs?: number
}

/**
 * Seal as an MCP server: who may connect, what each client may call, and a record of every call.
 * Transports (stdio, HTTP, relay) hand it a token and JSON-RPC messages; it owns every decision.
 */
export class SealMcpService {
  private readonly listeners = new Set<(event: SealMcpEvent) => void>()
  private readonly clients: SealMcpClientStore
  private readonly settings: SealMcpSettingsStore
  private readonly audit: SealMcpAuditLog
  private readonly approvals: SealMcpApprovals
  private readonly runner: SealMcpToolRunner
  private readonly calls = new SealMcpRateLimiter()
  private readonly door: SealMcpAdmissionDoor
  private readonly inFlight = new Map<string, AbortController>()
  private endpoints: () => SealMcpEndpoints = () => ({
    httpUrls: [],
    relayUrl: null,
    relayConnected: false
  })

  constructor(private readonly options: SealMcpServiceOptions) {
    this.clients = new SealMcpClientStore(join(options.dir, 'clients.json'), () =>
      this.emit({ type: 'clients' })
    )
    this.settings = new SealMcpSettingsStore(join(options.dir, 'settings.json'))
    this.audit = new SealMcpAuditLog(join(options.dir, 'audit.jsonl'), (entry) =>
      this.emit({ type: 'audit', entry })
    )
    this.approvals = new SealMcpApprovals((event) => this.emit(event), options.approvalTimeoutMs)
    this.runner = new SealMcpToolRunner({ runtime: options.runtime, approvals: this.approvals })
    this.door = new SealMcpAdmissionDoor({
      settings: () => this.settings.get(),
      authenticate: (token) => this.clients.authenticate(token),
      refused: (peer, client, detail) =>
        this.record(peer, client, { method: 'authenticate', outcome: 'unauthorized', detail })
    })
  }

  /** Reads what is saved on disk. Nothing may use the service before this resolves. */
  async start(): Promise<void> {
    await Promise.all([this.clients.load(), this.settings.load(), this.audit.load()])
  }

  async stop(): Promise<void> {
    this.approvals.declineAll()
    for (const call of this.inFlight.values()) {
      call.abort()
    }
    await this.audit.flush()
  }

  onEvent(listener: (event: SealMcpEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** The transports report where they listen, so Settings can show the URLs. */
  setEndpoints(endpoints: () => SealMcpEndpoints): void {
    this.endpoints = endpoints
  }

  statusChanged(): void {
    this.emit({ type: 'status' })
  }

  status(): SealMcpStatus {
    return {
      settings: this.settings.get(),
      ...this.endpoints(),
      toolCount: SEAL_MCP_TOOL_NAMES.length
    }
  }

  getSettings(): SealMcpSettings {
    return this.settings.get()
  }

  updateSettings(patch: Partial<SealMcpSettings>): SealMcpSettings {
    const next = this.settings.update(patch)
    this.emit({ type: 'settings' })
    return next
  }

  listClients(): SealMcpClient[] {
    return this.clients.list()
  }

  createClient(args: SealMcpClientCreateArgs): SealMcpClientCreated {
    return this.clients.create(args)
  }

  /** The token stops working at once, and anything the client has waiting is dropped. */
  revokeClient(id: string): boolean {
    const revoked = this.clients.revoke(id)
    this.dropClientWork(id)
    return revoked
  }

  removeClient(id: string): boolean {
    const removed = this.clients.remove(id)
    this.dropClientWork(id)
    return removed
  }

  /** The machines a client's allowlist can name. */
  async listMachines(): Promise<SealMcpMachine[]> {
    const machines = await (await this.options.runtime()).machines.list()
    return machines.map(({ id, label }) => ({ id, label }))
  }

  listAudit(query?: SealMcpAuditQuery): SealMcpAuditEntry[] {
    return this.audit.list(query)
  }

  listApprovals(): SealMcpApprovalRequest[] {
    return this.approvals.list()
  }

  respondApproval(id: string, approved: boolean): boolean {
    return this.approvals.respond(id, approved)
  }

  /** Decides whether a caller holding `token` may talk to the server over this transport. */
  admit(token: string | null | undefined, peer: SealMcpPeer): SealMcpAdmission {
    return this.door.admit(token, peer)
  }

  /** Answers one JSON-RPC message from an admitted client; null when it needs no reply. */
  async handle(
    client: SealMcpClient,
    peer: SealMcpPeer,
    message: unknown,
    signal?: AbortSignal
  ): Promise<McpJsonRpcMessage | null> {
    if (!isMcpRecord(message)) {
      return mcpError(null, -32_600, 'Not a JSON-RPC message.')
    }
    const id = mcpRequestId(message)
    const method = typeof message.method === 'string' ? message.method : ''
    if (id === null) {
      this.cancelIfAsked(client, method, message.params)
      return null
    }
    if (method === 'ping') {
      return answerMcpRequest(
        message,
        this.host(client, peer, () => {})
      )
    }
    const startedAt = Date.now()
    const wait = this.calls.take(client.id, client.callsPerMinute)
    if (wait > 0) {
      this.record(peer, client, { method, outcome: 'rate-limited' })
      return mcpError(id, MCP_RATE_LIMITED, `Rate limit reached. Try again in ${wait} seconds.`)
    }
    const key = `${client.id}:${String(id)}`
    const call = new AbortController()
    const abort = (): void => call.abort()
    signal?.addEventListener('abort', abort, { once: true })
    this.inFlight.set(key, call)
    const seen: { tool: string | null; outcome: SealMcpToolOutcome | null } = {
      tool: null,
      outcome: null
    }
    try {
      const reply = await answerMcpRequest(
        message,
        this.host(
          client,
          peer,
          (tool, outcome) => {
            seen.tool = tool
            seen.outcome = outcome
          },
          call.signal
        )
      )
      const { outcome } = seen
      this.record(peer, client, {
        method,
        tool: seen.tool,
        outcome: outcome?.outcome ?? (reply && 'error' in reply ? 'error' : 'ok'),
        machine: outcome?.machine,
        summary: outcome?.summary,
        approved: outcome?.approved,
        detail: outcome?.detail,
        durationMs: Date.now() - startedAt
      })
      return reply
    } finally {
      signal?.removeEventListener('abort', abort)
      this.inFlight.delete(key)
    }
  }

  private host(
    client: SealMcpClient,
    peer: SealMcpPeer,
    onToolOutcome: (tool: string, outcome: SealMcpToolOutcome) => void,
    signal?: AbortSignal
  ): Parameters<typeof answerMcpRequest>[1] {
    return {
      serverInfo: { name: 'seal', title: 'Seal', version: this.options.version },
      instructions: INSTRUCTIONS,
      listTools: () => sealMcpToolListFor(client),
      callTool: async (name, args) => {
        // Re-read the client so a revocation during a batch stops the rest of it.
        const current = this.clients.get(client.id)
        const outcome =
          current && current.revokedAt === null
            ? await this.runner.call(
                { client: current, transport: peer.transport, signal },
                name,
                args
              )
            : REVOKED
        onToolOutcome(name, outcome)
        return outcome
      }
    }
  }

  private cancelIfAsked(client: SealMcpClient, method: string, params: unknown): void {
    if (method !== 'notifications/cancelled' || !isMcpRecord(params)) {
      return
    }
    const { requestId } = params
    if (typeof requestId === 'string' || typeof requestId === 'number') {
      this.inFlight.get(`${client.id}:${String(requestId)}`)?.abort()
    }
  }

  private dropClientWork(clientId: string): void {
    this.approvals.declineAll(clientId)
    for (const [key, call] of this.inFlight) {
      if (key.startsWith(`${clientId}:`)) {
        call.abort()
      }
    }
  }

  private record(
    peer: SealMcpPeer,
    client: SealMcpClient | null,
    entry: Partial<SealMcpAuditEntry> & Pick<SealMcpAuditEntry, 'method' | 'outcome'>
  ): void {
    this.audit.record({
      clientId: client?.id ?? null,
      clientName: client?.name ?? null,
      transport: peer.transport,
      remote: peer.remote,
      method: entry.method,
      tool: entry.tool ?? null,
      machine: entry.machine ?? null,
      summary: entry.summary ?? null,
      outcome: entry.outcome,
      approved: entry.approved ?? null,
      durationMs: entry.durationMs ?? 0,
      detail: entry.detail ? auditDetail(entry.detail) : null
    })
  }

  private emit(event: SealMcpEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }
}
