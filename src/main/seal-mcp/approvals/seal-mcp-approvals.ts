import { randomUUID } from 'node:crypto'
import type { SealMcpApprovalRequest, SealMcpEvent } from '../../../shared/seal-mcp/seal-mcp-types'

const DEFAULT_TIMEOUT_MS = 120_000
/** A client cannot bury the user in prompts: further calls are declined until some are answered. */
const MAX_PENDING_PER_CLIENT = 5

type Pending = { request: SealMcpApprovalRequest; settle: (approved: boolean) => void }

export type SealMcpApprovalAsk = Omit<SealMcpApprovalRequest, 'id' | 'requestedAt' | 'expiresAt'>

/**
 * MCP calls waiting for a person to approve them in the Seal app. A call nobody answers in time
 * is declined, so a server with no app attached never runs it.
 */
export class SealMcpApprovals {
  private readonly pending = new Map<string, Pending>()

  constructor(
    private readonly emit: (event: SealMcpEvent) => void,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS
  ) {}

  list(): SealMcpApprovalRequest[] {
    return [...this.pending.values()].map((waiting) => waiting.request)
  }

  request(ask: SealMcpApprovalAsk, signal?: AbortSignal): Promise<boolean> {
    const waitingForClient = this.list().filter((item) => item.clientId === ask.clientId).length
    if (signal?.aborted || waitingForClient >= MAX_PENDING_PER_CLIENT) {
      return Promise.resolve(false)
    }
    const requestedAt = Date.now()
    const request: SealMcpApprovalRequest = {
      ...ask,
      id: randomUUID(),
      requestedAt,
      expiresAt: requestedAt + this.timeoutMs
    }
    return new Promise<boolean>((resolve) => {
      const settle = (approved: boolean): void => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        if (this.pending.delete(request.id)) {
          this.emit({ type: 'approval-settled', id: request.id })
          resolve(approved)
        }
      }
      const onAbort = (): void => settle(false)
      const timer = setTimeout(() => settle(false), this.timeoutMs)
      signal?.addEventListener('abort', onAbort, { once: true })
      this.pending.set(request.id, { request, settle })
      this.emit({ type: 'approval-requested', request })
    })
  }

  /** False when nothing waits under this id, e.g. it already timed out. */
  respond(id: string, approved: boolean): boolean {
    const waiting = this.pending.get(id)
    if (!waiting) {
      return false
    }
    waiting.settle(approved)
    return true
  }

  declineAll(clientId?: string): void {
    for (const waiting of this.pending.values()) {
      if (clientId === undefined || waiting.request.clientId === clientId) {
        waiting.settle(false)
      }
    }
  }
}
