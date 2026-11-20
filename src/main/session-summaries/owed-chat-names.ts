import { LiveSessionJsonStore } from '../live-sessions/live-session-json-store'

/** A name a session's row was given that its chat has not taken. */
export type OwedChatName = {
  chatSessionId: string
  title: string
  /** The chat's user-given name when the row was named; absent when this host did not hold the chat then. */
  chatHad?: string | null
}

export type OwedChatNames = {
  get(chatSessionId: string): OwedChatName | undefined
  set(chatSessionId: string, owed: OwedChatName): unknown
  delete(chatSessionId: string): unknown
}

function isOwedChatName(item: unknown): item is OwedChatName {
  return (
    typeof item === 'object' &&
    item !== null &&
    'chatSessionId' in item &&
    typeof item.chatSessionId === 'string' &&
    'title' in item &&
    typeof item.title === 'string' &&
    (!('chatHad' in item) || item.chatHad === null || typeof item.chatHad === 'string')
  )
}

const MAX_OWED = 200

/** Owed names on disk: one a chat never took is still the row's, and written again, after a restart. */
export class SavedOwedChatNames implements OwedChatNames {
  private readonly byChat = new Map<string, OwedChatName>()
  private readonly store: LiveSessionJsonStore<OwedChatName>

  constructor(path: string, log?: (message: string, error?: unknown) => void) {
    this.store = new LiveSessionJsonStore(path, isOwedChatName, log)
  }

  async load(): Promise<void> {
    for (const owed of await this.store.load()) {
      this.byChat.set(owed.chatSessionId, owed)
    }
  }

  get(chatSessionId: string): OwedChatName | undefined {
    return this.byChat.get(chatSessionId)
  }

  set(chatSessionId: string, owed: OwedChatName): void {
    this.byChat.delete(chatSessionId)
    this.byChat.set(chatSessionId, owed)
    // Chats long gone never take their names; the newest are the ones still worth writing.
    for (const oldest of [...this.byChat.keys()].slice(0, -MAX_OWED)) {
      this.byChat.delete(oldest)
    }
    this.save()
  }

  delete(chatSessionId: string): void {
    if (this.byChat.delete(chatSessionId)) {
      this.save()
    }
  }

  flush(): Promise<void> {
    return this.store.flush()
  }

  private save(): void {
    this.store.save([...this.byChat.values()])
  }
}
