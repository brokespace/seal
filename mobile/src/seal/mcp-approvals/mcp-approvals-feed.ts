import { useCallback, useSyncExternalStore } from 'react'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import { readMcpApprovals } from './mcp-approval-operations'
import { mcpApprovalsWatchFrameSchema, type McpApproval } from './mcp-approval-schemas'

export type McpApprovalsFeedState = {
  loaded: boolean
  /** Set when the host cannot be asked, e.g. a Seal server from before it had an MCP server. */
  error: string | null
  approvals: McpApproval[]
}

const EMPTY: McpApprovalsFeedState = { loaded: false, error: null, approvals: [] }

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const oldestFirst = (a: McpApproval, b: McpApproval) => a.requestedAt - b.requestedAt

/** One `sealMcp.watchApprovals` per host client, shared by the hub row and the approvals screen. */
class McpApprovalsFeed {
  private state = EMPTY
  private readonly listeners = new Set<() => void>()
  private closeStream: (() => void) | null = null

  constructor(private readonly client: RpcClient) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    if (!this.closeStream) {
      this.open()
    }
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) {
        this.closeStream?.()
        this.closeStream = null
      }
    }
  }

  readonly getState = (): McpApprovalsFeedState => this.state

  /** Re-reads what is waiting; reopens the stream if the host ended it. */
  async refresh(): Promise<void> {
    if (!this.closeStream && this.listeners.size > 0) {
      this.open()
    }
    try {
      this.accept(await readMcpApprovals(this.client))
    } catch (error) {
      this.set({ ...this.state, loaded: true, error: errorText(error) })
    }
  }

  remove(id: string): void {
    this.set({ ...this.state, approvals: this.state.approvals.filter((a) => a.id !== id) })
  }

  private open(): void {
    this.closeStream = this.client.subscribe('sealMcp.watchApprovals', null, (raw) => {
      const parsed = mcpApprovalsWatchFrameSchema.safeParse(raw)
      if (!parsed.success) {
        return
      }
      const frame = parsed.data
      switch (frame.type) {
        case 'ready':
          this.accept(frame.approvals)
          return
        case 'event':
          if (frame.event.type === 'approval-settled') {
            this.remove(frame.event.id)
          } else {
            const request = frame.event.request
            this.accept([...this.state.approvals.filter((a) => a.id !== request.id), request])
          }
          return
        case 'error':
          this.closeStream = null
          this.set({ ...this.state, loaded: true, error: frame.message ?? null })
          return
        case 'end':
          this.closeStream = null
      }
    })
  }

  private accept(approvals: readonly McpApproval[]): void {
    this.set({ loaded: true, error: null, approvals: [...approvals].sort(oldestFirst) })
  }

  private set(next: McpApprovalsFeedState): void {
    this.state = next
    for (const listener of this.listeners) {
      listener()
    }
  }
}

const feeds = new WeakMap<RpcClient, McpApprovalsFeed>()

function feedFor(client: RpcClient): McpApprovalsFeed {
  let feed = feeds.get(client)
  if (!feed) {
    feed = new McpApprovalsFeed(client)
    feeds.set(client, feed)
  }
  return feed
}

const noSubscription = () => () => {}
const emptyState = () => EMPTY

export function useMcpApprovalsFeed(client: RpcClient | null): McpApprovalsFeedState & {
  refresh: () => Promise<void>
  remove: (id: string) => void
} {
  const feed = client ? feedFor(client) : null
  const state = useSyncExternalStore(
    feed ? feed.subscribe : noSubscription,
    feed ? feed.getState : emptyState
  )
  const refresh = useCallback(async () => {
    await feed?.refresh()
  }, [feed])
  const remove = useCallback((id: string) => feed?.remove(id), [feed])
  return { ...state, refresh, remove }
}
