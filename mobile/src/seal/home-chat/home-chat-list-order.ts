import type { HomeChatSummary } from '../../../../src/shared/home-chat/home-chat-types'

export type HomeChatListRow = { chat: HomeChatSummary; indented: boolean }

/** Newest first, each chat's workers right under it; a worker whose parent is gone stands alone. */
export function orderHomeChatRows(
  chats: readonly HomeChatSummary[],
  showWorkers: boolean
): HomeChatListRow[] {
  const ids = new Set(chats.map((chat) => chat.id))
  const newest = [...chats].sort((a, b) => b.updatedAt - a.updatedAt)
  const workersByParent = new Map<string, HomeChatSummary[]>()
  for (const chat of newest) {
    if (chat.parentChatId && ids.has(chat.parentChatId)) {
      const siblings = workersByParent.get(chat.parentChatId) ?? []
      siblings.push(chat)
      workersByParent.set(chat.parentChatId, siblings)
    }
  }
  const rows: HomeChatListRow[] = []
  const visit = (chat: HomeChatSummary, indented: boolean) => {
    if (chat.parentChatId && !showWorkers) {
      return
    }
    rows.push({ chat, indented })
    for (const child of workersByParent.get(chat.id) ?? []) {
      visit(child, true)
    }
  }
  for (const chat of newest) {
    if (!chat.parentChatId || !ids.has(chat.parentChatId)) {
      visit(chat, false)
    }
  }
  return rows
}

export function countHomeChatWorkers(chats: readonly HomeChatSummary[]): number {
  return chats.filter((chat) => chat.parentChatId).length
}
