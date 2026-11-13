import type { HomeChatThread } from '../thread/home-chat-thread'
import { activeItems, type HomeChatConversationItem } from '../thread/home-chat-thread-history'
import type { HomeChatThreadItem } from '../thread/home-chat-thread-items'

/** The CLI session to resume: only one made by this backend on this account still holds the thread. */
export function resumableSession(
  thread: HomeChatThread,
  backend: 'claude-code' | 'codex'
): string | null {
  const session = thread.meta.providerSession
  return session && session.backend === backend && session.accountId === thread.meta.accountId
    ? session.sessionId
    : null
}

/**
 * What the CLI session has not seen before this turn's message: everything when it is new (after a
 * compaction, a switch of account or backend), otherwise whatever landed since its last turn.
 */
export function missedItems(
  thread: HomeChatThread,
  input: HomeChatThreadItem,
  resuming: boolean
): HomeChatConversationItem[] {
  const through = resuming ? (thread.meta.providerSession?.throughSeq ?? 0) : 0
  // A summary written at the start of this turn sits after the message in the log but precedes it in the context.
  return activeItems(thread.items).filter(
    (item) => item.type === 'compaction' || (item.seq < input.seq && item.seq > through)
  )
}
