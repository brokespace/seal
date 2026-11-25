import type { HomeChatSummary } from '../../../shared/home-chat/home-chat-types'
import type { HomeChatThread } from './home-chat-thread'

/** What the thread list and the chat's header show; never the conversation itself. */
export function homeChatThreadSummary(thread: HomeChatThread): HomeChatSummary {
  const { meta } = thread
  return {
    id: meta.id,
    title: meta.title,
    ...(meta.parentChatId ? { parentChatId: meta.parentChatId } : {}),
    backend: meta.backend,
    accountId: meta.accountId,
    model: meta.model,
    status: thread.status,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    context: {
      usedTokens: meta.contextUsed ?? 0,
      windowTokens: meta.contextWindow ?? 0,
      compactions: thread.items.filter((item) => item.type === 'compaction').length
    },
    lastMachine: meta.lastMachine ?? null
  }
}
