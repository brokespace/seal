import type { AgentSessionChatSource } from '../../../../../shared/live-sessions/agent-session-chat-source'
import type {
  LiveTranscriptCursor,
  LiveTranscriptDelta
} from '../../../../../shared/live-sessions/live-session-types'

/** A session's history and live tail, as a chat source hands them to its view. */
export type AgentSessionTranscriptFeed = AgentSessionChatSource<unknown>['messages']

/**
 * One transcript over the registry. `watch` continues from the newest page read or the last delta
 * delivered, and re-attaches from there after a gap, so the deltas it delivers continue one another.
 * A watch started before any page was read delivers the newest page as a `reset` delta.
 */
export function liveTranscriptFeed(sessionId: string): AgentSessionTranscriptFeed {
  let cursor: LiveTranscriptCursor | null = null
  return {
    async page(before) {
      const page = await window.api.liveSessions.transcriptPage({ sessionId, before })
      if (before === undefined) {
        cursor = page.cursor
      }
      return page
    },
    watch(onDelta) {
      const api = window.api.liveSessions
      let closed = false
      let watchId: string | null = null
      let attempt = 0
      let early: { watchId: string; delta: LiveTranscriptDelta }[] = []
      const attach = (): void => {
        const mine = ++attempt
        if (watchId) {
          void api.unwatchTranscript({ watchId })
          watchId = null
        }
        early = []
        void api
          .watchTranscript({ sessionId, fromCursor: cursor })
          .then(({ watchId: id, page }) => {
            if (closed || mine !== attempt) {
              void api.unwatchTranscript({ watchId: id })
              return
            }
            watchId = id
            if (page) {
              deliver({
                sessionId,
                from: page.start,
                cursor: page.cursor,
                messages: page.messages,
                reset: true
              })
            }
            for (const held of early.splice(0)) {
              if (held.watchId === id && watchId === id) {
                deliver(held.delta)
              }
            }
          })
          // The page already read stays on screen; the next watch reads from the same cursor.
          .catch(() => {})
      }
      const deliver = (delta: LiveTranscriptDelta): void => {
        if (!delta.reset && delta.from !== cursor) {
          // A delta that does not continue what was delivered: read again from the cursor held.
          attach()
          return
        }
        cursor = delta.cursor
        onDelta(delta)
      }
      const off = api.onTranscriptDelta(({ watchId: id, delta }) => {
        if (closed || delta.sessionId !== sessionId) {
          return
        }
        if (watchId === null) {
          early.push({ watchId: id, delta })
        } else if (id === watchId) {
          deliver(delta)
        }
      })
      attach()
      return () => {
        closed = true
        off()
        if (watchId) {
          void api.unwatchTranscript({ watchId })
        }
      }
    }
  }
}
