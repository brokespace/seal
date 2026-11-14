import type { HomeChatDriver } from '../drivers/home-chat-driver'
import type { HomeChatThread } from '../thread/home-chat-thread'
import { activeItems } from '../thread/home-chat-thread-history'
import {
  compactionDue,
  KEEP_FRACTION,
  latestRequest,
  mechanicalSummary,
  tailStartIndex,
  withLatestRequest
} from './home-chat-compaction'
import type { HomeChatTurnRecorder } from './home-chat-turn-recorder'

export type HomeChatCompactionRequest = {
  thread: HomeChatThread
  driver: HomeChatDriver
  systemPrompt: string
  recorder: HomeChatTurnRecorder
  signal: AbortSignal
  /** Compact even when the context is not nearly full (the user asked, or the provider refused the request). */
  force: boolean
  /** False when the user asked for it. */
  auto: boolean
  /** Thread position of the divider; the default is the end. */
  ord?: number
}

/**
 * Replace the older part of the model's context with a summary once it is nearly full. The thread the
 * user reads keeps every message; only what the model is sent changes. Returns whether it compacted.
 */
export async function compactHomeChatThread(request: HomeChatCompactionRequest): Promise<boolean> {
  const { thread, driver, systemPrompt, signal } = request
  const window = driver.contextWindow
  if (!request.force && !compactionDue(driver.contextTokens(thread, systemPrompt), window)) {
    return false
  }
  const active = activeItems(thread.items)
  let start = tailStartIndex(active, window * KEEP_FRACTION, thread.meta.tokenRatio ?? 1)
  if (request.force && !request.auto && start <= 1) {
    // Asked for by hand on a short thread: keep the newest exchange, summarize the rest.
    start = active.findLastIndex((item) => item.type === 'user' && item.origin !== 'system')
  }
  const head = active.slice(0, start)
  // Nothing but an earlier summary would be summarized again.
  if (head.filter((item) => item.type !== 'compaction').length === 0) {
    return false
  }
  const tail = active.slice(start)
  let summary = ''
  try {
    summary = await driver.summarize({ thread, systemPrompt, items: head, signal })
  } catch (error) {
    signal.throwIfAborted()
    console.warn('[home-chat] the model could not summarize; condensing mechanically', error)
  }
  const request_ = tail.some((item) => item.type === 'user' && item.origin === 'user')
    ? null
    : latestRequest(head)
  request.recorder.compaction(
    withLatestRequest(summary.trim() || mechanicalSummary(head), request_),
    tail[0]?.seq ?? thread.lastSeq + 1,
    request.auto,
    request.ord
  )
  // The provider's own session still holds what was just summarized away; the next turn starts a
  // new one from the summary. Measured sizes describe the old context.
  thread.updateMeta({ providerSession: undefined, contextTokens: undefined })
  return true
}
