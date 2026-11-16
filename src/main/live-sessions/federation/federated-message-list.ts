import type { LiveMessage } from '../../../shared/live-sessions/live-session-types'

/** One server's messages as the desktop lists them: what its outbox reports, and sends that never reached it. */
export class FederatedMessageList {
  private readonly held = new Map<string, LiveMessage>()
  /** Messages the server never took: a retry sends them again under the same id. */
  private readonly unsent = new Set<string>()

  constructor(private readonly onChange: (message: LiveMessage) => void) {}

  get(messageId: string): LiveMessage | null {
    return this.held.get(messageId) ?? null
  }

  isUnsent(messageId: string): boolean {
    return this.unsent.has(messageId)
  }

  list(sessionId?: string): LiveMessage[] {
    return [...this.held.values()]
      .filter((message) => !sessionId || message.sessionId === sessionId)
      .sort((a, b) => a.createdAt - b.createdAt)
  }

  /** The server's word on a message. A call's answer can arrive after a newer frame, so an older one is ignored. */
  fromServer(message: LiveMessage): LiveMessage {
    const held = this.held.get(message.messageId)
    if (held && !this.unsent.has(message.messageId) && held.updatedAt > message.updatedAt) {
      return held
    }
    this.unsent.delete(message.messageId)
    return this.set(message)
  }

  /** The server's whole outbox after a (re)connect; sends that never reached it stay listed. */
  replaceFromServer(messages: readonly LiveMessage[]): void {
    const listed = new Set(messages.map((message) => message.messageId))
    for (const messageId of this.held.keys()) {
      if (!listed.has(messageId) && !this.unsent.has(messageId)) {
        this.held.delete(messageId)
      }
    }
    for (const message of messages) {
      this.fromServer(message)
    }
  }

  /** A send that did not reach the server: listed as failed so it can be retried. */
  failedToSend(message: LiveMessage): LiveMessage {
    this.unsent.add(message.messageId)
    return this.set(message)
  }

  /** A retry the server could not be asked for: the message stays failed, with why. */
  failedToRetry(messageId: string, error: string): LiveMessage | null {
    const held = this.held.get(messageId)
    return held ? this.set({ ...held, state: 'failed', error }) : null
  }

  /** The session now goes by another id. The server renames what it holds; this renames the rest. */
  renameSession(from: string, to: string): void {
    for (const message of this.held.values()) {
      if (message.sessionId === from && this.unsent.has(message.messageId)) {
        this.set({ ...message, sessionId: to })
      }
    }
  }

  private set(message: LiveMessage): LiveMessage {
    const held = this.held.get(message.messageId)
    this.held.set(message.messageId, message)
    if (!held || JSON.stringify(held) !== JSON.stringify(message)) {
      this.onChange(message)
    }
    return message
  }
}
