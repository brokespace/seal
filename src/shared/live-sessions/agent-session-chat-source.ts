// What the one chat view needs from a session it does not host: history, live tail, the outbox,
// the pending prompt and a composer transport. Built over the registry's own calls.
import type { AgentSessionPromptResponse } from '../agent-session/agent-session-question-answer'
import type {
  AgentSessionCapabilityFlags,
  LiveMessage,
  LiveSessionPermissionPrompt,
  LiveTranscriptCursor,
  LiveTranscriptDelta,
  LiveTranscriptPage
} from './live-session-types'

/** A message on its way to the session: the outbox's own record. */
export type LiveSessionPendingMessage = LiveMessage

/** An option id for an approval, or per-question answers for a question: the structured host's own shape. */
export type AgentSessionPromptAnswer = AgentSessionPromptResponse

/**
 * `ComposerTransport` is the transport the client's composer accepts in place of a terminal:
 * `NativeChatStructuredComposerTransport` on desktop, the phone composer's own on the phone.
 * Shared code cannot name either.
 */
export type AgentSessionChatSource<ComposerTransport> = {
  /** The record id. */
  sessionId: string
  messages: {
    /** The newest page, or the one before `before` (a page's `start`). */
    page(before?: LiveTranscriptCursor): Promise<LiveTranscriptPage>
    watch(onDelta: (delta: LiveTranscriptDelta) => void): () => void
  }
  /** The outbox. */
  pending: { list(): LiveSessionPendingMessage[]; retry(messageId: string): void }
  prompt: LiveSessionPermissionPrompt | null
  answer(promptId: string, answer: AgentSessionPromptAnswer): Promise<void>
  composer: ComposerTransport
  capabilities: AgentSessionCapabilityFlags
}
