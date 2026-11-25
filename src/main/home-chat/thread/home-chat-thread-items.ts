// The canonical thread log: what was said and done, in order. The UI and every model request derive from it.
import type { HomeChatNoticeSource } from '../../../shared/home-chat/home-chat-types'

export type HomeChatToolOutcome = 'ok' | 'error' | 'refusal' | 'denied' | 'interrupted'

type PartBase = {
  /** Also the id of the chat entry the part renders as. */
  id: string
  ord: number
  /** When the part began, so its entry shows the same time live and after a restart; imported chats lack it. */
  at?: number
}

export type HomeChatToolCallPart = PartBase & {
  kind: 'tool_call'
  callId: string
  tool: string
  input: Record<string, unknown>
  approvalReason?: string
}

export type HomeChatAssistantPart =
  | (PartBase & { kind: 'text'; text: string })
  | (PartBase & { kind: 'thinking'; text: string; durationMs?: number })
  | HomeChatToolCallPart

/** Why a model round stopped. */
export type HomeChatRoundStop = 'end' | 'tool_calls' | 'cut_off' | 'interrupted'

export type HomeChatThreadEvent =
  | { kind: 'progress'; text: string }
  | { kind: 'error'; text: string }
  /** Shown to the user only; the model never reads it. */
  | { kind: 'notice'; source: HomeChatNoticeSource; text: string }
  | {
      kind: 'attachment'
      attachmentId: string
      name: string
      mimeType: string
      size: number
      machine?: string
    }

export type HomeChatUserItem = {
  type: 'user'
  ord: number
  text: string
  /** `notice` is Seal reporting a finished job, worker or routine; `system` steers the model and is never shown. */
  origin: 'user' | 'notice' | 'system'
  source?: HomeChatNoticeSource
}

export type HomeChatAssistantItem = {
  type: 'assistant'
  parts: HomeChatAssistantPart[]
  stop: HomeChatRoundStop
}

export type HomeChatToolResultItem = {
  type: 'tool_result'
  callId: string
  tool: string
  /** Exactly what the model was told. */
  content: string
  outcome: HomeChatToolOutcome
  machine?: string
  durationMs?: number
}

export type HomeChatCompactionItem = {
  type: 'compaction'
  ord: number
  summary: string
  /** Items from this seq on stay in the model's context word for word. */
  keepFromSeq: number
  auto: boolean
}

export type HomeChatEventItem = { type: 'event'; ord: number; event: HomeChatThreadEvent }

export type HomeChatThreadItemBody =
  | HomeChatUserItem
  | HomeChatAssistantItem
  | HomeChatToolResultItem
  | HomeChatCompactionItem
  | HomeChatEventItem

export type HomeChatThreadItem = HomeChatThreadItemBody & {
  /** Position in the log, from 1 with no gaps. */
  seq: number
  id: string
  at: number
}

/** The provider-side session a CLI driver resumes instead of replaying the thread. */
export type HomeChatProviderSession = {
  backend: 'claude-code' | 'codex'
  accountId: string | null
  sessionId: string
  /** The provider session has seen every item up to this seq. */
  throughSeq: number
}
