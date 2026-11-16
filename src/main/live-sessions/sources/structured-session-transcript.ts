import { projectStructuredItemsToNativeChat } from '../../../shared/agent-session/view/structured-agent-session-projection'
import type {
  LiveSession,
  LiveTranscriptCursor,
  LiveTranscriptPage
} from '../../../shared/live-sessions/live-session-types'
import type { NativeChatMessage } from '../../../shared/native-chat/native-chat-types'
import { getStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'

const DEFAULT_PAGE = 200

/** A chat's conversation as its own view shows it, read from the journal its host keeps. */
export async function structuredSessionTranscript(sessionId: string): Promise<NativeChatMessage[]> {
  const host = getStructuredAgentSessionHost()
  if (!host) {
    return []
  }
  return projectStructuredItemsToNativeChat((await host.journalSnapshot(sessionId)).items)
}

/** The chat a record stands for, when its history is a journal on this machine. */
export function localChatSessionId(session: LiveSession | null): string | null {
  return session?.surface.kind === 'chat' && session.machine.kind === 'local'
    ? session.surface.sessionId
    : null
}

/** A page of a chat's history; its cursors count messages, where a transcript file's count bytes. */
export async function structuredSessionTranscriptPage(
  session: Pick<LiveSession, 'id'>,
  chatSessionId: string,
  before: LiveTranscriptCursor | null,
  limit = DEFAULT_PAGE
): Promise<LiveTranscriptPage> {
  const messages = await structuredSessionTranscript(chatSessionId)
  const end = Math.min(before ?? messages.length, messages.length)
  const start = Math.max(0, end - limit)
  return {
    sessionId: session.id,
    messages: messages.slice(start, end),
    cursor: messages.length,
    start,
    more: start > 0
  }
}

/** What a chat said after `cursor`; `shrank` when a rewind cut its history below it. */
export async function structuredSessionTranscriptSince(
  chatSessionId: string,
  cursor: LiveTranscriptCursor
): Promise<{ messages: NativeChatMessage[]; cursor: LiveTranscriptCursor; shrank: boolean }> {
  const messages = await structuredSessionTranscript(chatSessionId)
  return cursor > messages.length
    ? { messages: [], cursor, shrank: true }
    : { messages: messages.slice(cursor), cursor: messages.length, shrank: false }
}
