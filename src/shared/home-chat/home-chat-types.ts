// The home-page assistant chat: one conversation per chat, persisted by main and streamed to the renderer.

export type HomeChatBackendKind = 'claude-code' | 'openai-compatible'

export type HomeChatStatus = 'idle' | 'running' | 'error'

export type HomeChatToolStatus = 'awaiting-approval' | 'running' | 'ok' | 'error' | 'denied'

type HomeChatEntryBase = {
  /** Stable across every copy of the entry; the copy with the higher `rev` wins. */
  id: string
  rev: number
  /** Epoch ms when the entry was first created. */
  at: number
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
  /** Claude account id from the account provider; null runs on the default login. */
  accountId: string | null
  /** OpenAI-compatible model override; null uses the configured default. */
  model: string | null
  status: HomeChatStatus
  createdAt: number
  updatedAt: number
}

export type HomeChat = HomeChatSummary & {
  entries: HomeChatEntry[]
}

export type HomeChatAccountOption = {
  /** Null is the default Claude login. */
  id: string | null
  label: string
  detail?: string
}

export type HomeChatOpenAiSettings = {
  baseUrl: string
  model: string
  apiKeyConfigured: boolean
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
  openai?: { baseUrl?: string; model?: string; apiKey?: string | null }
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
