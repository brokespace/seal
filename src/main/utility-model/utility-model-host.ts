import {
  UTILITY_MODEL_PROVIDER_IDS,
  type UtilityModelProviderId,
  type UtilityModelProviderStatus,
  type UtilityModelRequest,
  type UtilityModelStatus
} from '../../shared/utility-model/utility-model-types'
import type { UtilityModelChoice } from '../../shared/utility-model/utility-model-selection'
import { CloudflareAiConfigStore, type CloudflareAiConfigFields } from './cloudflare-ai-config'
import { OpenRouterAccountStore } from './openrouter-utility-provider'
import {
  createUtilityModelProviderSources,
  type UtilityModelHostContext,
  type UtilityModelProviderSource
} from './utility-model-provider-sources'
import { UtilityModelService, type UtilityModelReply } from './utility-model-service'

/**
 * A utility model as a feature calls it: the provider and models are whoever chose them, the
 * fallbacks, pauses and failure classes are the same for all. Throws UtilityModelError.
 */
export type UtilityModelClient = {
  complete(request: UtilityModelRequest, signal?: AbortSignal): Promise<UtilityModelReply>
  /** The chosen provider has an account on this host. */
  isConfigured(): Promise<boolean>
  health(): { pausedUntil: number | null }
  /** Fires when a provider's health changes: a pause starts or ends, or a model turns out unavailable. */
  subscribe(listener: () => void): () => void
}

export type UtilityModelHostDeps = {
  cloudflare?: CloudflareAiConfigStore
  openRouter?: OpenRouterAccountStore
  /** Replaces the built-in providers, for tests. */
  sources?: Partial<Record<UtilityModelProviderId, UtilityModelProviderSource>>
}

/** This host's utility models: every provider's account and the one service each is called through. */
export class UtilityModelHost {
  private readonly cloudflare: CloudflareAiConfigStore
  private readonly openRouter: OpenRouterAccountStore
  private readonly sources: Record<UtilityModelProviderId, UtilityModelProviderSource>
  private readonly services = new Map<UtilityModelProviderId, UtilityModelService>()
  private readonly listeners = new Set<() => void>()
  private context: UtilityModelHostContext | null = null

  constructor(deps: UtilityModelHostDeps = {}) {
    this.cloudflare = deps.cloudflare ?? new CloudflareAiConfigStore()
    this.openRouter = deps.openRouter ?? new OpenRouterAccountStore()
    this.sources = {
      ...createUtilityModelProviderSources({
        cloudflare: this.cloudflare,
        openRouter: this.openRouter,
        context: () => this.context
      }),
      ...deps.sources
    }
  }

  /** Agent CLIs and MiniMax run on accounts and settings the runtime owns; until this, only API keys saved here work. */
  connect(context: UtilityModelHostContext): void {
    this.context = context
  }

  /** One provider's service, shared by every feature so a rate limit pauses them all. */
  provider(id: UtilityModelProviderId): UtilityModelService {
    let service = this.services.get(id)
    if (!service) {
      service = new UtilityModelService({
        backend: async () => {
          const account = await this.sources[id]()
          return account.provider
            ? { provider: account.provider, models: account.defaultModels }
            : null
        }
      })
      service.subscribe(() => this.emit())
      this.services.set(id, service)
    }
    return service
  }

  /** The utility model a feature runs on; `choice` is read on every call, so a settings change applies at once. */
  client(choice: () => UtilityModelChoice): UtilityModelClient {
    return {
      complete: (request, signal) => {
        const { provider, model, fallbackModel } = choice()
        return this.provider(provider).complete(request, signal, {
          choice: { model, fallbackModel }
        })
      },
      isConfigured: () => this.provider(choice().provider).isConfigured(),
      health: () => this.provider(choice().provider).health(),
      subscribe: (listener) => this.subscribe(listener)
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async providerStatus(id: UtilityModelProviderId): Promise<UtilityModelProviderStatus> {
    const { provider: _provider, ...account } = await this.sources[id]()
    return { provider: id, ...account, ...this.provider(id).health() }
  }

  async providers(): Promise<UtilityModelProviderStatus[]> {
    return await Promise.all(UTILITY_MODEL_PROVIDER_IDS.map((id) => this.providerStatus(id)))
  }

  /** The Cloudflare account as its own settings section shows it. */
  async status(): Promise<UtilityModelStatus> {
    const config = await this.cloudflare.load()
    return {
      provider: 'cloudflare-workers-ai',
      configured: config.credentials !== null,
      source: config.source,
      accountHint: config.credentials ? config.credentials.accountId.slice(-4) : null,
      tokenProtection: config.tokenProtection,
      model: config.model,
      fallbackModel: config.fallbackModel,
      ...this.provider('cloudflare-workers-ai').health()
    }
  }

  async setCloudflare(fields: CloudflareAiConfigFields): Promise<UtilityModelStatus> {
    this.cloudflare.save(fields)
    this.provider('cloudflare-workers-ai').configChanged()
    return await this.status()
  }

  async clearCloudflare(): Promise<UtilityModelStatus> {
    this.cloudflare.clear()
    this.provider('cloudflare-workers-ai').configChanged()
    return await this.status()
  }

  async setOpenRouter(apiKey: string): Promise<UtilityModelProviderStatus> {
    this.openRouter.save(apiKey)
    this.provider('openrouter').configChanged()
    return await this.providerStatus('openrouter')
  }

  async clearOpenRouter(): Promise<UtilityModelProviderStatus> {
    this.openRouter.clear()
    this.provider('openrouter').configChanged()
    return await this.providerStatus('openrouter')
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }
}

let host: UtilityModelHost | null = null

/** One per process, made on first use: the desktop and a headless server both have one. */
export function getUtilityModelHost(): UtilityModelHost {
  host ??= new UtilityModelHost()
  return host
}
