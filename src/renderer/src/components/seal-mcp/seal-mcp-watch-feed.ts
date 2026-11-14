import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type {
  SealMcpApprovalRequest,
  SealMcpEvent
} from '../../../../shared/seal-mcp/seal-mcp-types'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { subscribeRuntimeRpc } from '@/runtime/rpc/subscriptions/runtime-rpc-subscribe'
import { sealHostKey } from '@/components/seal-session/seal-session-status-store'

/** `attached`: a stream opened or reopened, so anything read before it may be stale. */
export type SealMcpFeedEvent = SealMcpEvent | { type: 'attached' }

type WatchFrame =
  | { type: 'ready'; subscriptionId: string; approvals: SealMcpApprovalRequest[] }
  | { type: 'event'; event: SealMcpEvent }
  | { type: 'end' }

type Feed = {
  approvals: readonly SealMcpApprovalRequest[]
  observers: Set<(event: SealMcpFeedEvent) => void>
  dispose: () => void
}

const EMPTY: readonly SealMcpApprovalRequest[] = []
// Why 5 s: a dropped stream is rare; retry without hammering a server that is restarting.
const RETRY_MS = 5_000
const feeds = new Map<string, Feed>()

function readWatchFrame(value: unknown): WatchFrame | null {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return null
  }
  if (value.type === 'end') {
    return { type: 'end' }
  }
  if (
    value.type === 'ready' &&
    'subscriptionId' in value &&
    typeof value.subscriptionId === 'string' &&
    'approvals' in value &&
    Array.isArray(value.approvals)
  ) {
    return { type: 'ready', subscriptionId: value.subscriptionId, approvals: value.approvals }
  }
  if (
    value.type === 'event' &&
    'event' in value &&
    typeof value.event === 'object' &&
    value.event !== null &&
    'type' in value.event
  ) {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the server's own event; only the two approval types are read, and the rest just wake observers.
    return { type: 'event', event: value.event as SealMcpEvent }
  }
  return null
}

function withoutApproval(
  approvals: readonly SealMcpApprovalRequest[],
  id: string
): readonly SealMcpApprovalRequest[] {
  const next = approvals.filter((request) => request.id !== id)
  return next.length === approvals.length ? approvals : next.length ? next : EMPTY
}

function adopt(feed: Feed, event: SealMcpFeedEvent): void {
  if (event.type === 'approval-requested') {
    feed.approvals = [...withoutApproval(feed.approvals, event.request.id), event.request]
  } else if (event.type === 'approval-settled') {
    feed.approvals = withoutApproval(feed.approvals, event.id)
  }
  feed.observers.forEach((notify) => notify(event))
}

function hasCode(error: unknown, ...codes: string[]): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    codes.some((code) => code === error.code)
  )
}

function openFeed(key: string, target: RuntimeClientTarget): Feed {
  const held: Feed = { approvals: EMPTY, observers: new Set(), dispose: () => {} }
  let close: (() => void) | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  let subscriptionId: string | null = null
  let generation = 0
  const release = (): void => {
    close?.()
    close = undefined
    // Why only remote: closing the local stream aborts it on the host; a paired server is told.
    if (subscriptionId && target.kind === 'environment') {
      void callRuntimeRpc(
        target,
        'sealMcp.unwatch',
        { subscriptionId },
        { timeoutMs: 10_000, skipCompatibilityCheck: true }
      ).catch(() => {})
    }
    subscriptionId = null
  }
  const open = (): void => {
    const attempt = ++generation
    const live = (): boolean => feeds.get(key) === held && generation === attempt
    // Keeps the requests it has: the next stream sends the current list as soon as it opens.
    const lose = (error?: unknown): void => {
      if (!live()) {
        return
      }
      generation += 1
      release()
      // An older server has no MCP methods; asking again every 5 s would not change that.
      if (!hasCode(error, 'method_not_found', 'forbidden')) {
        retry = setTimeout(open, RETRY_MS)
      }
    }
    void subscribeRuntimeRpc(target, 'sealMcp.watch', null, {
      onEvent: (value) => {
        const frame = readWatchFrame(value)
        if (!live() || !frame) {
          return
        }
        if (frame.type === 'ready') {
          subscriptionId = frame.subscriptionId
          held.approvals = frame.approvals.length ? frame.approvals : EMPTY
          adopt(held, { type: 'attached' })
        } else if (frame.type === 'event') {
          adopt(held, frame.event)
        } else {
          lose()
        }
      },
      onError: lose,
      onClose: lose
    }).then((handle) => {
      if (live()) {
        close = handle.unsubscribe
      } else {
        handle.unsubscribe()
      }
    }, lose)
  }
  held.dispose = () => {
    generation += 1
    clearTimeout(retry)
    release()
  }
  open()
  return held
}

/** One `sealMcp.watch` stream per Seal server, shared by the approval prompt and Settings. */
export function watchSealMcp(
  target: RuntimeClientTarget,
  observer: (event: SealMcpFeedEvent) => void
): () => void {
  const key = sealHostKey(target)
  let feed = feeds.get(key)
  if (!feed) {
    feed = openFeed(key, target)
    feeds.set(key, feed)
  }
  const held = feed
  held.observers.add(observer)
  return () => {
    held.observers.delete(observer)
    // A remount in the same task keeps the stream.
    queueMicrotask(() => {
      if (held.observers.size === 0 && feeds.get(key) === held) {
        feeds.delete(key)
        held.dispose()
      }
    })
  }
}

/** Calls waiting for an answer on this server, oldest first; the same array until one changes. */
export function readSealMcpApprovals(
  target: RuntimeClientTarget
): readonly SealMcpApprovalRequest[] {
  return feeds.get(sealHostKey(target))?.approvals ?? EMPTY
}

/** Answers a waiting call. False when it had already expired or was answered somewhere else. */
export async function respondSealMcpApproval(
  target: RuntimeClientTarget,
  approvalId: string,
  approved: boolean
): Promise<boolean> {
  const { settled } = await callRuntimeRpc<{ settled: boolean }>(
    target,
    'sealMcp.respondApproval',
    { approvalId, approved },
    { timeoutMs: 15_000 }
  )
  // Either way nothing waits under this id any more, even if the settled event is still in flight.
  const feed = feeds.get(sealHostKey(target))
  if (feed) {
    adopt(feed, { type: 'approval-settled', id: approvalId })
  }
  return settled
}
