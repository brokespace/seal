import type { LiveMessage } from '../../../shared/live-sessions/live-session-types'

/** One server's messages as the desktop lists them: what the server's outbox reports. */
export class FederatedMessageList {
  private readonly held = new Map<string, LiveMessage>()

  constructor(private readonly onChange: (message: LiveMessage) => void) {}

  get(messageId: string): LiveMessage | null {
    return this.held.get(messageId) ?? null
  }

  list(sessionId?: string): LiveMessage[] {
    return [...this.held.values()]
      .filter((message) => !sessionId || message.sessionId === sessionId)
      .sort((a, b) => a.createdAt - b.createdAt)
  }

  /** The server's word on a message. A call's answer can arrive after a newer frame, so an older one is ignored. */
  fromServer(message: LiveMessage): LiveMessage {
    const held = this.held.get(message.messageId)
    return held && held.updatedAt > message.updatedAt ? held : this.set(message)
  }

  /** The server's whole outbox after a (re)connect. */
  replaceFromServer(messages: readonly LiveMessage[]): void {
    const listed = new Set(messages.map((message) => message.messageId))
    for (const messageId of this.held.keys()) {
      if (!listed.has(messageId)) {
        this.held.delete(messageId)
      }
    }
    for (const message of messages) {
      this.fromServer(message)
    }
  }

  /** A retry the server could not be asked for: the message stays failed, with why. */
  failedToRetry(messageId: string, error: string): LiveMessage | null {
    const held = this.held.get(messageId)
    return held ? this.set({ ...held, state: 'failed', error }) : null
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
