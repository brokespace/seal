import { randomUUID } from 'node:crypto'
import type { AgentSessionStatusEvent } from '../../shared/agent-session/agent-session-wire'
import type { StructuredAgentSessionHost } from '../native-chat/agent-session-wire/host/structured-agent-session-host'
import { getStructuredAgentSessionHost } from '../native-chat/agent-session-wire/host/structured-agent-session-registry'

function chatsNamedIn(event: AgentSessionStatusEvent): Set<string> {
  if (event.type === 'status') {
    return new Set([event.session.sessionId])
  }
  if (event.type !== 'snapshot') {
    return new Set()
  }
  // A rename reaches a chat with no status row only through `conversationNames`.
  return new Set(
    [...event.sessions, ...(event.conversationNames ?? [])].map((chat) => chat.sessionId)
  )
}

/** Chat names from the structured host installed now; `follow` moves to one installed since. */
export function followStructuredChatNames(
  listener: (chatSessionId: string) => void,
  log?: (message: string, error?: unknown) => void
): { follow: () => void; stop: () => void } {
  const id = `session-titles:${randomUUID()}`
  let host: StructuredAgentSessionHost | null = null
  let release: (() => void) | null = null
  const emit = (event: AgentSessionStatusEvent): void => {
    try {
      chatsNamedIn(event).forEach(listener)
    } catch (error) {
      // The feed drops a subscriber that throws.
      log?.('[session-titles] reading a chat name failed', error)
    }
  }
  const follow = (): void => {
    const current = getStructuredAgentSessionHost()
    if (current === host) {
      return
    }
    release?.()
    host = current
    release = current?.subscribeStatus({ id, emit }) ?? null
  }
  follow()
  return {
    follow,
    stop: () => {
      release?.()
      release = null
      host = null
    }
  }
}
