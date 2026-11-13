import type { HomeChatEntryWriter } from '../home-chat-entry-writer'
import type { HomeChatToolResult } from '../tools/home-chat-tool-executor'

export type HomeChatTurnContext = {
  writer: HomeChatEntryWriter
  systemPrompt: string
  signal: AbortSignal
  runTool: (tool: string, input: unknown) => Promise<HomeChatToolResult>
}

/** One chat's live connection to a model; it may hold a process open between turns. */
export type HomeChatBackendSession = {
  /** Resolves when the model finishes answering; throws when the turn fails. */
  runTurn: (text: string, ctx: HomeChatTurnContext) => Promise<void>
  close: () => Promise<void>
}

/** Backend-owned state persisted with the chat so a restart can continue the conversation. */
export type HomeChatBackendState = {
  claudeSessionId?: string
  openaiMessages?: unknown[]
}
