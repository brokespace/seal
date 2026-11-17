import type { AgentType } from '../../../../../shared/agent-status/contracts/agent-status-types'
import type { LiveMessage } from '../../../../../shared/live-sessions/live-session-types'
import { normalizeImageTranscriptMessages } from '../../../../../shared/native-chat/transcript/native-chat-image-transcript-markers'
import type { NativeChatDeliveryNotice } from '../../native-chat/messages/rows/NativeChatMessageRow'
import type { NativeChatLiveSession } from '../../native-chat/session/terminal/read/native-chat-live-session-contract'
import type { PendingRow } from '../live-session-pending-rows'
import { liveMessageStateLabel } from '../live-session-presentation'
import type { LiveTranscriptState } from '../use-live-transcript'

/** The transcript with the outbox's rows, as the chat's message list reads a session. */
export function externalAgentSessionChatRows({
  agent,
  providerSessionId,
  transcript,
  pending,
  working
}: {
  agent: AgentType
  providerSessionId: string | null
  transcript: LiveTranscriptState & Pick<NativeChatLiveSession, 'loadEarlier' | 'retainHistory'>
  pending: readonly PendingRow[]
  /** Waiting on its own subagents or background tasks is still the agent's turn. */
  working: boolean
}): NativeChatLiveSession {
  const settled = transcript.messages.length || pending.length ? 'ready' : 'empty'
  // Claude records a pasted image's path as a turn of its own: shown as an image, as other chats show it.
  const recorded = normalizeImageTranscriptMessages(transcript.messages)
  return {
    messages: pending.length ? [...recorded, ...pending.map((p) => p.row)] : recorded,
    agent,
    sessionId: providerSessionId,
    status: transcript.phase === 'ready' ? (working ? 'working' : settled) : transcript.phase,
    error: transcript.error ?? undefined,
    readPhase: transcript.phase,
    hasMore: transcript.hasMore,
    loadingEarlier: transcript.loadingEarlier,
    olderHistoryGeneration: 0,
    loadEarlier: transcript.loadEarlier,
    retainHistory: transcript.retainHistory
  }
}

/** A failed send says why and offers Retry; one still on its way shows as sending. */
export function externalAgentSessionDeliveryNotices(
  pending: readonly PendingRow[],
  onRetry: (message: LiveMessage) => void
): ReadonlyMap<string, NativeChatDeliveryNotice> {
  const notices = new Map<string, NativeChatDeliveryNotice>()
  for (const { row, message } of pending) {
    if (message.state === 'failed') {
      notices.set(row.id, { text: liveMessageStateLabel(message), onSend: () => onRetry(message) })
    } else if (message.state !== 'delivered') {
      notices.set(row.id, { sending: true })
    }
  }
  return notices
}
