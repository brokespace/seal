import { createNonSecureContextUuid } from '../../../../shared/non-secure-context-uuid'
import type { LiveMessage } from '../../../../shared/live-sessions/live-session-types'
import { liveSessionRegistryStore } from './live-session-registry-store'

const SEND_ATTEMPTS = 3

/** Sends survive a dropped IPC round trip: the same messageId is idempotent in the outbox. */
async function sendIdempotently(message: LiveMessage): Promise<void> {
  const api = window.api.liveSessions
  for (let attempt = 1; ; attempt++) {
    try {
      liveSessionRegistryStore.upsertMessage(
        await api.send({
          sessionId: message.sessionId,
          messageId: message.messageId,
          text: message.text
        })
      )
      return
    } catch (error) {
      if (attempt >= SEND_ATTEMPTS) {
        liveSessionRegistryStore.upsertMessage({
          ...message,
          state: 'failed',
          error: error instanceof Error ? error.message : String(error),
          updatedAt: Date.now()
        })
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt))
    }
  }
}

/** Queues a message for a session; its row shows at once and follows the outbox from there. */
export function sendLiveMessage(sessionId: string, text: string): void {
  const now = Date.now()
  const message: LiveMessage = {
    messageId: createNonSecureContextUuid(),
    sessionId,
    text,
    state: 'queued',
    route: null,
    error: null,
    createdAt: now,
    updatedAt: now
  }
  liveSessionRegistryStore.upsertMessage(message)
  void sendIdempotently(message)
}
