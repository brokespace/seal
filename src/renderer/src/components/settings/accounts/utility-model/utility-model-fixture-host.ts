import type { SessionSummariesStatus } from '../../../../../../shared/session-summaries/session-summary-contracts'
import { UTILITY_MODEL_PROVIDERS } from '../../../../../../shared/utility-model/utility-model-provider-catalog'
import type {
  UtilityModelCatalogEntry,
  UtilityModelProviderId,
  UtilityModelProviderStatus
} from '../../../../../../shared/utility-model/utility-model-types'

type FixtureProvider = Partial<UtilityModelProviderStatus>

/** Every provider's status as a host reports it; a fixture overrides the ones it is about. */
export function fixtureProviderStatuses(
  overrides: Partial<Record<UtilityModelProviderId, FixtureProvider>>
): UtilityModelProviderStatus[] {
  return UTILITY_MODEL_PROVIDERS.map((provider) => ({
    provider: provider.id,
    configured: false,
    source: null,
    accountHint: null,
    tokenProtection: null,
    defaultModels: [provider.defaultModel, provider.defaultFallbackModel].filter(
      (model): model is string => model !== null
    ),
    unavailableModels: [],
    pausedUntil: null,
    lastFailure: null,
    ...overrides[provider.id]
  }))
}

/** Answers the utility-model and session-summaries RPCs a settings fixture makes; for `*.fixture.tsx` only. */
export function stubUtilityModelFixtureHost(host: {
  providers: UtilityModelProviderStatus[]
  summaries?: SessionSummariesStatus
  catalogs?: Partial<Record<UtilityModelProviderId, UtilityModelCatalogEntry[]>>
}): () => void {
  return (): void => {
    window.api.runtime = {
      ...window.api.runtime,
      call: async ({ method, params }) => {
        const provider =
          typeof params === 'object' && params !== null && 'provider' in params
            ? (params.provider as UtilityModelProviderId)
            : undefined
        const result =
          method === 'utilityModel.providers'
            ? host.providers.filter(
                (entry) => provider === undefined || entry.provider === provider
              )
            : method === 'utilityModel.listModels'
              ? { ok: true, models: host.catalogs?.[provider ?? 'cloudflare-workers-ai'] ?? [] }
              : host.summaries
        return { id: 'fixture', ok: true, result, _meta: { runtimeId: 'fixture' } }
      }
    }
  }
}
