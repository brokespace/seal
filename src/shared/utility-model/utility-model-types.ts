// Utility models: small, cheap models Seal calls for its own chores (session summaries), never an agent's model.
// Plain JSON, shared by main, the runtime RPC and the renderer.

export const UTILITY_MODEL_PROVIDER_IDS = ['cloudflare-workers-ai'] as const
export type UtilityModelProviderId = (typeof UTILITY_MODEL_PROVIDER_IDS)[number]

export type UtilityModelMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type UtilityModelRequest = {
  messages: UtilityModelMessage[]
  maxTokens: number
  /** How long the provider may take; a long reply needs more than the default. */
  timeoutMs?: number
}

export const UTILITY_MODEL_FAILURE_KINDS = [
  'not-configured',
  /** The provider rejected the credentials. */
  'unauthorized',
  /** The account's plan cannot run this model (Cloudflare 403 on the Workers Free plan). */
  'plan-unavailable',
  /** 429, or the day's free allocation is used up. */
  'rate-limited',
  'model-not-found',
  'network',
  'bad-response'
] as const
export type UtilityModelFailureKind = (typeof UTILITY_MODEL_FAILURE_KINDS)[number]

export type UtilityModelFailure = {
  kind: UtilityModelFailureKind
  /** Provider text, safe to show: never holds a credential. */
  message: string
  model: string | null
  at: number
}

export type UtilityModelCatalogEntry = {
  id: string
  description: string | null
}

export const CLOUDFLARE_AI_DEFAULT_MODEL = '@cf/zai-org/glm-4.7-flash'
export const CLOUDFLARE_AI_DEFAULT_FALLBACK_MODEL = '@cf/google/gemma-4-26b-a4b-it'

/** What a client may know about the host's utility model: presence and health, never the credentials. */
export type UtilityModelStatus = {
  provider: UtilityModelProviderId
  configured: boolean
  /** Saved from Settings, or read from `~/.config/seal/cloudflare-ai.json`. */
  source: 'settings' | 'config-file' | null
  /** The account id's last four characters, enough to tell two accounts apart. */
  accountHint: string | null
  /** How the saved token is stored; null when it comes from the config file or none is saved. */
  tokenProtection: 'sealed' | 'plaintext' | null
  model: string
  fallbackModel: string
  /** Models the account cannot run (plan refused, or no such model); requests skip them until the config changes. */
  unavailableModels: UtilityModelFailure[]
  /** Requests are held until this time (the next UTC day after a daily limit); null when running. */
  pausedUntil: number | null
  lastFailure: UtilityModelFailure | null
}

export type UtilityModelTestResult =
  | { ok: true; model: string; reply: string; elapsedMs: number; usedFallback: boolean }
  | { ok: false; failure: UtilityModelFailure }

export type UtilityModelCatalogResult =
  | { ok: true; models: UtilityModelCatalogEntry[] }
  | { ok: false; failure: UtilityModelFailure }
