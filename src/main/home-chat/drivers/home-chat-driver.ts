import type { HomeChatTurnRecorder } from '../engine/home-chat-turn-recorder'
import type { HomeChatThread } from '../thread/home-chat-thread'
import type { HomeChatConversationItem } from '../thread/home-chat-thread-history'
import type { HomeChatThreadItem, HomeChatUserItem } from '../thread/home-chat-thread-items'
import type { HomeChatToolCall, HomeChatToolReply } from '../tools/home-chat-tool-runner'

export type HomeChatDriverTurn = {
  thread: HomeChatThread
  /** The message that opened this turn; it is already in the thread. */
  input: HomeChatThreadItem & HomeChatUserItem
  systemPrompt: string
  recorder: HomeChatTurnRecorder
  runTool: (call: HomeChatToolCall) => Promise<HomeChatToolReply>
  signal: AbortSignal
  /** Summarize older turns when the context is nearly full (or now, with force). */
  compact: (force?: boolean) => Promise<void>
  /** A CLI driver's provider session now holds this turn; later turns resume it. */
  confirmSession: (sessionId: string) => void
}

export type HomeChatSummaryRequest = {
  thread: HomeChatThread
  systemPrompt: string
  /** The part of the conversation the summary replaces. */
  items: readonly HomeChatConversationItem[]
  signal: AbortSignal
}

/**
 * One way of running the model. A driver starts whatever it needs for a turn and leaves nothing
 * running when the turn ends: no process or connection outlives `runTurn` or `summarize`.
 */
export type HomeChatDriver = {
  runTurn: (turn: HomeChatDriverTurn) => Promise<void>
  /** Ask the model to summarize part of the conversation, without tools. */
  summarize: (request: HomeChatSummaryRequest) => Promise<string>
  contextWindow: number
  /** Tokens the next request would carry, before anything new is added. */
  contextTokens: (thread: HomeChatThread, systemPrompt: string) => number
}
