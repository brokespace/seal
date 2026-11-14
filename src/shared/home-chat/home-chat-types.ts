// The home-page assistant chat: one conversation per chat, persisted by main and streamed to the renderer.

/** Who runs the model: the Claude Agent SDK, `codex exec`, or Seal's own loop over a model API. */
export type HomeChatBackendKind = 'claude-code' | 'codex' | 'openai-compatible'

export const HOME_CHAT_BACKEND_KINDS: readonly HomeChatBackendKind[] = [
  'claude-code',
  'codex',
  'openai-compatible'
]

export type HomeChatStatus = 'idle' | 'running' | 'error'

export type HomeChatToolStatus = 'awaiting-approval' | 'running' | 'ok' | 'error' | 'denied'

type HomeChatEntryBase = {
  /** Stable across every copy of the entry; the copy with the higher `rev` wins. */
  id: string
  rev: number
  /** Epoch ms when the entry was first created. */
  at: number
  /** Position in the thread, assigned once by main; viewers sort by it, never by arrival. */
  ord: number
}

export type HomeChatEntry = HomeChatEntryBase &
  (
    | { kind: 'user'; text: string; delivery: 'sending' | 'delivered' | 'failed' }
    | { kind: 'assistant'; text: string; streaming: boolean }
    | { kind: 'thinking'; text: string; streaming: boolean; durationMs?: number }
    | {
        kind: 'tool'
        tool: string
        input: Record<string, unknown>
        /** Machine label the tool acted on, when it targets one. */
        machine?: string
        status: HomeChatToolStatus
        output?: string
        durationMs?: number
        /** Why the call needs the user's approval before it runs. */
        approvalReason?: string
      }
    | { kind: 'progress'; text: string }
    /** Older messages were summarized for the model; the thread above stays readable. */
    | { kind: 'compaction'; summary: string; auto: boolean }
    | { kind: 'error'; text: string }
    /** Something finished or fired while nobody was typing: a job, a worker or a routine. */
    | { kind: 'notice'; source: HomeChatNoticeSource; text: string }
    | {
        kind: 'attachment'
        attachmentId: string
        name: string
        mimeType: string
        size: number
        machine?: string
      }
  )

export type HomeChatNoticeSource = 'job' | 'subagent' | 'routine' | 'approval'

export type HomeChatSummary = {
  id: string
  title: string
  /** Set on background worker chats spawned by another chat. */
  parentChatId?: string
  backend: HomeChatBackendKind
  /** Account id for the backend's provider; null runs on the default login. */
  accountId: string | null
  /** Model override; null uses the backend's default. */
  model: string | null
  status: HomeChatStatus
  createdAt: number
  updatedAt: number
  context: HomeChatContextUsage
  /** Label of the machine the assistant last acted on in this thread. */
  lastMachine: string | null
}

export type HomeChatContextUsage = {
  /** Tokens the next request to the model would carry, measured or estimated. */
  usedTokens: number
  windowTokens: number
  compactions: number
}

export type HomeChat = HomeChatSummary & {
  entries: HomeChatEntry[]
}

export type HomeChatAccountOption = {
  backend: 'claude-code' | 'codex'
  /** Null is the provider's default login. */
  id: string | null
  label: string
  detail?: string
}

export type HomeChatOpenAiSettings = {
  baseUrl: string
  model: string
  apiKeyConfigured: boolean
  /** The model's context window in tokens; compaction starts before it fills. */
  contextWindow: number
}

export type HomeChatMachineStatus = 'online' | 'connecting' | 'offline' | 'error'

/** One machine as the assistant sees it, for the chat's context bar. */
export type HomeChatMachineOption = {
  id: string
  label: string
  kind: 'local' | 'remote' | 'hop'
  status: HomeChatMachineStatus
  address?: string
}

export type HomeChatSearchProvider = 'duckduckgo' | 'brave' | 'tavily' | 'searxng'

export type HomeChatWebSettings = {
  searchProvider: HomeChatSearchProvider
  /** Base URL of a SearXNG instance, used when searchProvider is searxng. */
  searxngUrl: string
  searchApiKeyConfigured: boolean
}

export type HomeChatSettings = {
  defaultBackend: HomeChatBackendKind
  openai: HomeChatOpenAiSettings
  web: HomeChatWebSettings
}

export type HomeChatSettingsUpdate = {
  defaultBackend?: HomeChatBackendKind
  openai?: { baseUrl?: string; model?: string; apiKey?: string | null; contextWindow?: number }
  web?: { searchProvider?: HomeChatSearchProvider; searxngUrl?: string; apiKey?: string | null }
}

export type HomeChatCreateArgs = {
  backend?: HomeChatBackendKind
  accountId?: string | null
  model?: string | null
}

export type HomeChatUpdateArgs = {
  chatId: string
  title?: string
  backend?: HomeChatBackendKind
  accountId?: string | null
  model?: string | null
}

export type HomeChatEvent =
  | { type: 'entry'; chatId: string; entry: HomeChatEntry }
  | { type: 'summary'; chat: HomeChatSummary }
  | { type: 'deleted'; chatId: string }
  | { type: 'memory' }
  /** The assistant asked Seal to show something. */
  | { type: 'open'; target: HomeChatOpenTarget }

export type HomeChatOpenView =
  | 'home'
  | 'machines'
  | 'sessions'
  | 'tasks'
  | 'activity'
  | 'automations'
  | 'skills'
  | 'settings'

export type HomeChatOpenTarget =
  | { kind: 'view'; view: HomeChatOpenView }
  | { kind: 'thread'; chatId: string }
  | { kind: 'machine'; machineId: string }
  /** Stop an external agent session and resume it in a Seal pane. */
  | { kind: 'take-over'; sessionId: string }
