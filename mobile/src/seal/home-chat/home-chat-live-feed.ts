import { useEffect, useSyncExternalStore } from 'react'
import { AppState } from 'react-native'
import { mergeHomeChatEntry } from '../../../../src/shared/home-chat/home-chat-entry-merge'
import type {
  HomeChat,
  HomeChatEvent,
  HomeChatSummary
} from '../../../../src/shared/home-chat/home-chat-types'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import { fetchHomeChat, fetchHomeChats, watchHomeChats } from './home-chat-operations'

export type HomeChatDetail = {
  /** Null once the host says the chat does not exist. */
  chat: HomeChat | null
  loaded: boolean
  error: string | null
}

export type HomeChatFeedSnapshot = {
  chats: HomeChatSummary[] | null
  listError: string | null
  /** The watch stream is open and has delivered its first frame. */
  live: boolean
  details: ReadonlyMap<string, HomeChatDetail>
}

const RETRY_MIN_MS = 1_000
const RETRY_MAX_MS = 30_000

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/** Keeps entries of a refetched chat that arrived on the stream while the read was in flight. */
function mergeFetched(previous: HomeChat | null, fetched: HomeChat): HomeChat {
  if (!previous) {
    return fetched
  }
  let entries = fetched.entries
  for (const entry of previous.entries) {
    entries = mergeHomeChatEntry(entries, entry)
  }
  return { ...fetched, entries }
}

function withSummary(chats: HomeChatSummary[] | null, summary: HomeChatSummary) {
  if (!chats) {
    return [summary]
  }
  const index = chats.findIndex((chat) => chat.id === summary.id)
  if (index === -1) {
    return [summary, ...chats]
  }
  const next = chats.slice()
  next[index] = summary
  return next
}

/** One `homeChat.watch` per host client, shared by the chat list and every open conversation. */
export class HomeChatLiveFeed {
  private snapshot: HomeChatFeedSnapshot = {
    chats: null,
    listError: null,
    live: false,
    details: new Map()
  }
  private readonly listeners = new Set<() => void>()
  private retainCount = 0
  private readonly wantedChats = new Map<string, number>()
  private stopWatch: (() => void) | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retryDelay = RETRY_MIN_MS
  private appStateSubscription: { remove: () => void } | null = null
  private appActive = AppState.currentState === 'active'

  constructor(private readonly client: RpcClient) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): HomeChatFeedSnapshot => this.snapshot

  retain(): () => void {
    this.retainCount += 1
    if (this.retainCount === 1) {
      this.appActive = AppState.currentState === 'active'
      this.appStateSubscription = AppState.addEventListener('change', (next) => {
        const wasActive = this.appActive
        this.appActive = next === 'active'
        if (this.appActive && !wasActive) {
          this.startWatch()
        } else if (!this.appActive && wasActive) {
          this.endWatch()
        }
      })
      this.startWatch()
    }
    let released = false
    return () => {
      if (released) {
        return
      }
      released = true
      this.retainCount -= 1
      if (this.retainCount === 0) {
        this.appStateSubscription?.remove()
        this.appStateSubscription = null
        this.endWatch()
      }
    }
  }

  /** Loads the chat now and again after every reconnect, so missed entries come back. */
  retainChat(chatId: string): () => void {
    this.wantedChats.set(chatId, (this.wantedChats.get(chatId) ?? 0) + 1)
    void this.refreshChat(chatId)
    let released = false
    return () => {
      if (released) {
        return
      }
      released = true
      const count = (this.wantedChats.get(chatId) ?? 1) - 1
      if (count <= 0) {
        this.wantedChats.delete(chatId)
      } else {
        this.wantedChats.set(chatId, count)
      }
    }
  }

  async refreshChat(chatId: string): Promise<void> {
    try {
      const fetched = await fetchHomeChat(this.client, chatId)
      const previous = this.snapshot.details.get(chatId)?.chat ?? null
      this.setDetail(chatId, {
        chat: fetched ? mergeFetched(previous, fetched) : null,
        loaded: true,
        error: null
      })
      if (fetched) {
        const { entries: _entries, ...summary } = fetched
        this.update({ chats: withSummary(this.snapshot.chats, summary) })
      }
    } catch (error) {
      const previous = this.snapshot.details.get(chatId)
      this.setDetail(chatId, {
        chat: previous?.chat ?? null,
        loaded: previous?.loaded ?? false,
        error: errorText(error)
      })
    }
  }

  async refreshList(): Promise<void> {
    try {
      this.update({ chats: await fetchHomeChats(this.client), listError: null })
    } catch (error) {
      this.update({ listError: errorText(error) })
    }
  }

  applyChat(chat: HomeChat): void {
    const { entries: _entries, ...summary } = chat
    this.setDetail(chat.id, { chat, loaded: true, error: null })
    this.update({ chats: withSummary(this.snapshot.chats, summary) })
  }

  applySummary(summary: HomeChatSummary): void {
    this.update({ chats: withSummary(this.snapshot.chats, summary) })
    const detail = this.snapshot.details.get(summary.id)
    if (detail?.chat) {
      this.setDetail(summary.id, { ...detail, chat: { ...detail.chat, ...summary } })
    }
  }

  removeChat(chatId: string): void {
    this.update({ chats: this.snapshot.chats?.filter((chat) => chat.id !== chatId) ?? null })
    if (this.snapshot.details.has(chatId)) {
      this.setDetail(chatId, { chat: null, loaded: true, error: null })
    }
  }

  private startWatch(): void {
    if (this.stopWatch || this.retainCount === 0 || !this.appActive) {
      return
    }
    this.clearRetry()
    this.stopWatch = watchHomeChats(
      this.client,
      (frame) => {
        if (frame.type === 'ready') {
          this.retryDelay = RETRY_MIN_MS
          this.update({ chats: frame.chats, listError: null, live: true })
          for (const chatId of this.wantedChats.keys()) {
            void this.refreshChat(chatId)
          }
        } else if (frame.type === 'event') {
          this.applyEvent(frame.event)
        } else {
          this.restartLater()
        }
      },
      () => {
        if (!this.snapshot.chats) {
          void this.refreshList()
        }
        this.restartLater()
      }
    )
  }

  private endWatch(): void {
    this.clearRetry()
    this.stopWatch?.()
    this.stopWatch = null
    this.update({ live: false })
  }

  private restartLater(): void {
    this.endWatch()
    if (this.retainCount === 0) {
      return
    }
    const delay = this.retryDelay
    this.retryDelay = Math.min(RETRY_MAX_MS, this.retryDelay * 2)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.startWatch()
    }, delay)
  }

  private clearRetry(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
  }

  private applyEvent(event: HomeChatEvent): void {
    switch (event.type) {
      case 'entry': {
        const detail = this.snapshot.details.get(event.chatId)
        if (detail?.chat) {
          const entries = mergeHomeChatEntry(detail.chat.entries, event.entry)
          if (entries !== detail.chat.entries) {
            this.setDetail(event.chatId, { ...detail, chat: { ...detail.chat, entries } })
          }
        }
        return
      }
      case 'summary':
        this.applySummary(event.chat)
        return
      case 'deleted':
        this.removeChat(event.chatId)
        return
      case 'memory':
      case 'open':
        return
    }
  }

  private setDetail(chatId: string, detail: HomeChatDetail): void {
    const details = new Map(this.snapshot.details)
    details.set(chatId, detail)
    this.update({ details })
  }

  private update(patch: Partial<HomeChatFeedSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) {
      listener()
    }
  }
}

const feeds = new WeakMap<RpcClient, HomeChatLiveFeed>()

function feedFor(client: RpcClient): HomeChatLiveFeed {
  let feed = feeds.get(client)
  if (!feed) {
    feed = new HomeChatLiveFeed(client)
    feeds.set(client, feed)
  }
  return feed
}

const EMPTY_SNAPSHOT: HomeChatFeedSnapshot = {
  chats: null,
  listError: null,
  live: false,
  details: new Map()
}
const noopSubscribe = () => () => {}
const emptySnapshot = () => EMPTY_SNAPSHOT

/** The host's chats kept live while mounted; pass `chatId` to also keep that conversation loaded. */
export function useHomeChatFeed(
  client: RpcClient | null,
  chatId?: string
): { feed: HomeChatLiveFeed | null; snapshot: HomeChatFeedSnapshot } {
  const feed = client ? feedFor(client) : null
  const snapshot = useSyncExternalStore(
    feed?.subscribe ?? noopSubscribe,
    feed?.getSnapshot ?? emptySnapshot
  )
  useEffect(() => feed?.retain(), [feed])
  useEffect(() => (feed && chatId ? feed.retainChat(chatId) : undefined), [feed, chatId])
  return { feed, snapshot }
}
