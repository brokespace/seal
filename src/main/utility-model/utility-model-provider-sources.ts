import type { TuiAgent } from '../../shared/agent-launch/catalog/tui-agent'
import type { MiniMaxEndpoint } from '../../shared/global-settings-types'
import { utilityModelProvider } from '../../shared/utility-model/utility-model-provider-catalog'
import type {
  UtilityModelCatalogEntry,
  UtilityModelProviderId,
  UtilityModelProviderStatus
} from '../../shared/utility-model/utility-model-types'
import { readMiniMaxApiKey } from '../minimax/minimax-api-key-store'
import { detectInstalledAgentsWithShellPathHydration } from '../preflight/installed-agent-detection'
import type { CommitMessageAgentEnvironmentResolvers } from '../text-generation/execution/commit-message-agent-environment'
import {
  createAgentCliUtilityProvider,
  type AgentCliUtilityAgent
} from './agent-cli-utility-provider'
import type { CloudflareAiConfigStore } from './cloudflare-ai-config'
import { createCloudflareWorkersAiProvider } from './cloudflare-workers-ai-provider'
import { createOpenAiCompatibleProvider } from './openai-compatible-utility-provider'
import {
  createOpenRouterProvider,
  listOpenRouterModels,
  type OpenRouterAccountStore
} from './openrouter-utility-provider'
import type { UtilityModelProvider } from './utility-model-provider'

/** What the rest of the app lends the utility models: accounts and settings it already owns. */
export type UtilityModelHostContext = {
  agentEnvironment: () => CommitMessageAgentEnvironmentResolvers | undefined
  settings: () => {
    agentCmdOverrides?: Partial<Record<TuiAgent, string>> | null
    minimaxEndpoint?: MiniMaxEndpoint
  }
}

/** A provider's account on this host, and the provider to call when it has one. */
export type UtilityModelProviderAccount = Pick<
  UtilityModelProviderStatus,
  'configured' | 'source' | 'accountHint' | 'tokenProtection' | 'defaultModels'
> & {
  provider: UtilityModelProvider | null
  /** The provider's model list when it is public, so a picker can fill before an account is saved. */
  publicCatalog?: () => Promise<UtilityModelCatalogEntry[]>
}

export type UtilityModelProviderSource = () => Promise<UtilityModelProviderAccount>

const MINIMAX_API_ROOTS: Record<MiniMaxEndpoint, string> = {
  overseas: 'https://api.minimax.io/v1',
  cn: 'https://api.minimaxi.com/v1'
}
const INSTALLED_AGENTS_TTL_MS = 60_000

function catalogDefaults(id: UtilityModelProviderId): string[] {
  const { defaultModel, defaultFallbackModel } = utilityModelProvider(id)
  return defaultFallbackModel ? [defaultModel, defaultFallbackModel] : [defaultModel]
}

const NO_ACCOUNT = {
  configured: false,
  source: null,
  accountHint: null,
  tokenProtection: null,
  provider: null
} as const

/** Every provider Seal can run its own chores on, each read from the account the app already keeps. */
export function createUtilityModelProviderSources(deps: {
  cloudflare: CloudflareAiConfigStore
  openRouter: OpenRouterAccountStore
  context: () => UtilityModelHostContext | null
  installedAgents?: () => Promise<readonly string[]>
}): Record<UtilityModelProviderId, UtilityModelProviderSource> {
  let installed: { at: number; agents: Promise<readonly string[]> } | null = null
  const installedAgents = (): Promise<readonly string[]> => {
    if (!installed || Date.now() - installed.at > INSTALLED_AGENTS_TTL_MS) {
      const overrides = deps.context()?.settings().agentCmdOverrides
      const agents =
        deps.installedAgents?.() ??
        detectInstalledAgentsWithShellPathHydration(undefined, { agentCmdOverrides: overrides })
      installed = { at: Date.now(), agents: agents.catch(() => []) }
    }
    return installed.agents
  }

  const agentCli = (agent: AgentCliUtilityAgent): UtilityModelProviderSource => {
    const provider = createAgentCliUtilityProvider(agent, {
      environment: () => deps.context()?.agentEnvironment(),
      commandOverride: (id) => deps.context()?.settings().agentCmdOverrides?.[id] ?? undefined
    })
    return async () => {
      const defaultModels = catalogDefaults(agent)
      // Installed is all that can be known cheaply; whether the CLI is signed in shows on its first call.
      return (await installedAgents()).includes(agent)
        ? {
            configured: true,
            source: 'agent-cli',
            accountHint: null,
            tokenProtection: null,
            defaultModels,
            provider
          }
        : { ...NO_ACCOUNT, defaultModels }
    }
  }

  return {
    'cloudflare-workers-ai': async () => {
      const config = await deps.cloudflare.load()
      return {
        configured: config.credentials !== null,
        source: config.source,
        accountHint: config.credentials ? config.credentials.accountId.slice(-4) : null,
        tokenProtection: config.tokenProtection,
        // The models saved beside the account before a provider could be chosen still lead.
        defaultModels: [config.model, config.fallbackModel],
        provider: config.credentials ? createCloudflareWorkersAiProvider(config.credentials) : null
      }
    },
    openrouter: async () => {
      const account = await deps.openRouter.load()
      return {
        configured: account.apiKey !== null,
        source: account.source,
        accountHint: account.hint,
        tokenProtection: account.protection,
        defaultModels: catalogDefaults('openrouter'),
        provider: account.apiKey ? createOpenRouterProvider(account.apiKey) : null,
        publicCatalog: () => listOpenRouterModels()
      }
    },
    minimax: async () => {
      const defaultModels = catalogDefaults('minimax')
      let apiKey: string | null = null
      try {
        apiKey = readMiniMaxApiKey()
      } catch {
        // Sealed by another install or unreadable: behave as if nothing was saved.
      }
      if (!apiKey) {
        return { ...NO_ACCOUNT, defaultModels }
      }
      const endpoint = deps.context()?.settings().minimaxEndpoint ?? 'overseas'
      return {
        configured: true,
        // The key Settings > Accounts > MiniMax saved for usage; this reads it, never stores another.
        source: 'settings',
        accountHint: apiKey.slice(-4),
        tokenProtection: null,
        defaultModels,
        provider: createOpenAiCompatibleProvider({
          id: 'minimax',
          label: 'MiniMax',
          baseUrl: MINIMAX_API_ROOTS[endpoint],
          apiKey,
          listModels: async () => [...utilityModelProvider('minimax').models]
        })
      }
    },
    claude: agentCli('claude'),
    codex: agentCli('codex'),
    grok: agentCli('grok'),
    antigravity: agentCli('antigravity'),
    devin: agentCli('devin')
  }
}
