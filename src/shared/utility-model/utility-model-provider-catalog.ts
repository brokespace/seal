import {
  CLOUDFLARE_AI_DEFAULT_FALLBACK_MODEL,
  CLOUDFLARE_AI_DEFAULT_MODEL,
  type UtilityModelCatalogEntry,
  type UtilityModelProviderId
} from './utility-model-types'

export type UtilityModelProviderKind =
  /** An HTTP API called with a key saved in Seal. */
  | 'api'
  /** The agent's own CLI, run once per request on the account it is signed into. */
  | 'agent-cli'

export type UtilityModelProviderDescriptor = {
  id: UtilityModelProviderId
  /** A product name, never translated. */
  label: string
  kind: UtilityModelProviderKind
  defaultModel: string
  defaultFallbackModel: string | null
  /** Models offered before, or instead of, the provider's own list. */
  models: readonly UtilityModelCatalogEntry[]
}

/** `default` asks an agent CLI for the model its own settings name. */
export const AGENT_CLI_DEFAULT_MODEL = 'default'

export const OPENROUTER_DEFAULT_MODEL = 'openrouter/free'
export const OPENROUTER_DEFAULT_FALLBACK_MODEL = 'google/gemma-4-26b-a4b-it:free'
export const MINIMAX_DEFAULT_MODEL = 'MiniMax-M3.1-Flash'

const model = (id: string, description: string | null = null): UtilityModelCatalogEntry => ({
  id,
  description
})

export const UTILITY_MODEL_PROVIDERS: readonly UtilityModelProviderDescriptor[] = [
  {
    id: 'cloudflare-workers-ai',
    label: 'Cloudflare Workers AI',
    kind: 'api',
    defaultModel: CLOUDFLARE_AI_DEFAULT_MODEL,
    defaultFallbackModel: CLOUDFLARE_AI_DEFAULT_FALLBACK_MODEL,
    models: [model(CLOUDFLARE_AI_DEFAULT_MODEL), model(CLOUDFLARE_AI_DEFAULT_FALLBACK_MODEL)]
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'api',
    defaultModel: OPENROUTER_DEFAULT_MODEL,
    defaultFallbackModel: OPENROUTER_DEFAULT_FALLBACK_MODEL,
    models: [
      { ...model(OPENROUTER_DEFAULT_MODEL, 'Free Models Router'), free: true },
      { ...model(OPENROUTER_DEFAULT_FALLBACK_MODEL), free: true }
    ]
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    kind: 'api',
    defaultModel: MINIMAX_DEFAULT_MODEL,
    defaultFallbackModel: 'MiniMax-M3',
    models: [model(MINIMAX_DEFAULT_MODEL), model('MiniMax-M3')]
  },
  {
    id: 'claude',
    label: 'Claude',
    kind: 'agent-cli',
    // The account's alias for its smallest model; Bedrock and Vertex may reject a dated id.
    defaultModel: 'haiku',
    defaultFallbackModel: null,
    models: [model('haiku', 'Haiku'), model('sonnet', 'Sonnet')]
  },
  {
    id: 'codex',
    label: 'Codex',
    kind: 'agent-cli',
    defaultModel: 'gpt-5.4-mini',
    defaultFallbackModel: null,
    models: [model('gpt-5.4-mini', 'GPT-5.4 Mini')]
  },
  {
    id: 'grok',
    label: 'Grok',
    kind: 'agent-cli',
    defaultModel: AGENT_CLI_DEFAULT_MODEL,
    defaultFallbackModel: null,
    models: [model(AGENT_CLI_DEFAULT_MODEL)]
  },
  {
    id: 'antigravity',
    label: 'Antigravity',
    kind: 'agent-cli',
    defaultModel: AGENT_CLI_DEFAULT_MODEL,
    defaultFallbackModel: null,
    models: [model(AGENT_CLI_DEFAULT_MODEL)]
  },
  {
    id: 'devin',
    label: 'Devin',
    kind: 'agent-cli',
    defaultModel: AGENT_CLI_DEFAULT_MODEL,
    defaultFallbackModel: null,
    models: [model(AGENT_CLI_DEFAULT_MODEL)]
  }
]

export function utilityModelProvider(id: UtilityModelProviderId): UtilityModelProviderDescriptor {
  return (
    UTILITY_MODEL_PROVIDERS.find((provider) => provider.id === id) ?? UTILITY_MODEL_PROVIDERS[0]
  )
}
