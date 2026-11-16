import { projectStructuredItemsToNativeChat } from '../../../shared/agent-session/view/structured-agent-session-projection'
import type { NativeChatMessage } from '../../../shared/native-chat/native-chat-types'
import { getStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'

/** A chat's conversation as its own view shows it, read from the journal its host keeps. */
export async function structuredSessionTranscript(sessionId: string): Promise<NativeChatMessage[]> {
  const host = getStructuredAgentSessionHost()
  if (!host) {
    return []
  }
  return projectStructuredItemsToNativeChat((await host.journalSnapshot(sessionId)).items)
}
