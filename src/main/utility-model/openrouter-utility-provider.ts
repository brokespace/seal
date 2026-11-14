import type { SecretAtRestProtection } from '../../shared/secret-at-rest-protection'
import type { UtilityModelCatalogEntry } from '../../shared/utility-model/utility-model-types'
import { createEncryptedApiKeyFileStore } from '../credentials/encrypted-api-key-file-store'
import {
  createOpenAiCompatibleProvider,
  requestOpenAiCompatibleListing
} from './openai-compatible-utility-provider'
import type { UtilityModelProvider } from './utility-model-provider'
import {
  jsonRecord as record,
  jsonText as text,
  type UtilityModelFetch
} from './utility-model-http-request'

export const OPENROUTER_API_ROOT = 'https://openrouter.ai/api/v1'
export const OPENROUTER_API_KEY_ENV = 'OPENROUTER_API_KEY'

export type OpenRouterKeyStore = {
  read(): string | null
  save(value: string): void
  clear(): void
  protection(): SecretAtRestProtection | null
}

export type OpenRouterAccount = {
  apiKey: string | null
  /** Saved from Settings, or the `OPENROUTER_API_KEY` this process started with. */
  source: 'settings' | 'environment' | null
  /** The key's last four characters, enough to tell two keys apart. */
  hint: string | null
  protection: SecretAtRestProtection | null
}

/** This host's OpenRouter key: sealed like every other provider key, never logged or returned. */
export class OpenRouterAccountStore {
  private readonly saved: OpenRouterKeyStore
  private readonly env: () => string | undefined

  constructor(deps: { saved?: OpenRouterKeyStore; env?: () => string | undefined } = {}) {
    this.env = deps.env ?? (() => process.env[OPENROUTER_API_KEY_ENV])
    this.saved =
      deps.saved ??
      createEncryptedApiKeyFileStore({
        fileName: 'seal-openrouter-api-key.enc',
        envelopePrefix: 'seal-openrouter-api-key:v1:',
        providerLabel: 'OpenRouter',
        logScope: 'utility-model'
      })
  }

  load(): OpenRouterAccount {
    const saved = this.readSaved()
    const apiKey = saved ?? (this.env()?.trim() || null)
    return {
      apiKey,
      source: saved ? 'settings' : apiKey ? 'environment' : null,
      hint: apiKey ? apiKey.slice(-4) : null,
      protection: saved ? this.saved.protection() : null
    }
  }

  save(apiKey: string): void {
    this.saved.save(apiKey.trim())
  }

  /** Forgets what Settings saved; a key in the environment keeps working. */
  clear(): void {
    this.saved.clear()
  }

  private readSaved(): string | null {
    try {
      return this.saved.read()?.trim() || null
    } catch {
      // Sealed by another install or unreadable: behave as if nothing was saved.
      return null
    }
  }
}

function isFree(id: string, pricing: Record<string, unknown> | null): boolean {
  return (
    id.endsWith(':free') ||
    (pricing !== null && Number(pricing.prompt) === 0 && Number(pricing.completion) === 0)
  )
}

/** OpenRouter's public catalog: every model that answers in text, free ones first. */
export async function listOpenRouterModels(
  options: {
    apiKey?: string | null
    signal?: AbortSignal
    fetchImpl?: UtilityModelFetch
    baseUrl?: string
  } = {}
): Promise<UtilityModelCatalogEntry[]> {
  const body = await requestOpenAiCompatibleListing({
    label: 'OpenRouter',
    url: `${options.baseUrl ?? OPENROUTER_API_ROOT}/models`,
    apiKey: options.apiKey ?? null,
    signal: options.signal,
    fetchImpl: options.fetchImpl
  })
  const data = record(body)?.data
  const models = (Array.isArray(data) ? data : []).flatMap((entry): UtilityModelCatalogEntry[] => {
    const model = record(entry)
    const id = text(model?.id)
    const output = record(model?.architecture)?.output_modalities
    if (!id || (Array.isArray(output) && !output.includes('text'))) {
      return []
    }
    return [{ id, description: text(model?.name), free: isFree(id, record(model?.pricing)) }]
  })
  return models.sort(
    (a, b) => Number(b.free === true) - Number(a.free === true) || a.id.localeCompare(b.id)
  )
}

export function createOpenRouterProvider(
  apiKey: string,
  options: { fetchImpl?: UtilityModelFetch; baseUrl?: string } = {}
): UtilityModelProvider {
  const baseUrl = options.baseUrl ?? OPENROUTER_API_ROOT
  return createOpenAiCompatibleProvider(
    {
      id: 'openrouter',
      label: 'OpenRouter',
      baseUrl,
      apiKey,
      // A reasoning model would spend a short reply's whole budget thinking; hosts that cannot switch it off ignore this.
      extraBody: { reasoning: { enabled: false } },
      listModels: (signal) =>
        listOpenRouterModels({ apiKey, signal, fetchImpl: options.fetchImpl, baseUrl })
    },
    options.fetchImpl
  )
}
