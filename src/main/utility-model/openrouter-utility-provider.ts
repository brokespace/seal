import type { SecretAtRestProtection } from '../../shared/secret-at-rest-protection'
import type { UtilityModelCatalogEntry } from '../../shared/utility-model/utility-model-types'
import { createEncryptedApiKeyFileStore } from '../credentials/encrypted-api-key-file-store'
import {
  createOpenAiCompatibleProvider,
  requestOpenAiCompatibleJson
} from './openai-compatible-utility-provider'
import { SealConfigFile, sealConfigFilePath } from './seal-config-file'
import { UtilityModelError, type UtilityModelProvider } from './utility-model-provider'
import {
  jsonRecord as record,
  jsonText as text,
  type UtilityModelFetch
} from './utility-model-http-request'

export const OPENROUTER_API_ROOT = 'https://openrouter.ai/api/v1'
/** Decision models answer here only: chat/completions turns them down. Alpha, so its shape may change. */
export const OPENROUTER_DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions'
export const OPENROUTER_API_KEY_ENV = 'OPENROUTER_API_KEY'

export type OpenRouterKeyStore = {
  read(): string | null
  save(value: string): void
  clear(): void
  protection(): SecretAtRestProtection | null
}

export type OpenRouterAccount = {
  apiKey: string | null
  /** Saved from Settings, the `OPENROUTER_API_KEY` this process started with, or the config file. */
  source: 'settings' | 'environment' | 'config-file' | null
  /** The key's last four characters, enough to tell two keys apart. */
  hint: string | null
  protection: SecretAtRestProtection | null
}

/** `~/.config/seal/openrouter.json`, holding `{ "apiKey": "…" }`: the key of a host with no Settings UI. */
export function openRouterConfigFilePath(): string {
  return sealConfigFilePath('openrouter.json')
}

/** This host's OpenRouter key: sealed like every other provider key, never logged or returned. */
export class OpenRouterAccountStore {
  private readonly saved: OpenRouterKeyStore
  private readonly env: () => string | undefined
  private readonly configFile: SealConfigFile

  constructor(
    deps: {
      saved?: OpenRouterKeyStore
      env?: () => string | undefined
      configFilePath?: string
    } = {}
  ) {
    this.env = deps.env ?? (() => process.env[OPENROUTER_API_KEY_ENV])
    this.configFile = new SealConfigFile(
      deps.configFilePath ?? openRouterConfigFilePath(),
      'OpenRouter'
    )
    this.saved =
      deps.saved ??
      createEncryptedApiKeyFileStore({
        fileName: 'seal-openrouter-api-key.enc',
        envelopePrefix: 'seal-openrouter-api-key:v1:',
        providerLabel: 'OpenRouter',
        logScope: 'utility-model'
      })
  }

  async load(): Promise<OpenRouterAccount> {
    const saved = this.readSaved()
    const fromEnv = saved ? null : this.env()?.trim() || null
    const fromFile = saved || fromEnv ? null : text(record(await this.configFile.read())?.apiKey)
    const apiKey = saved ?? fromEnv ?? fromFile
    return {
      apiKey,
      source: saved ? 'settings' : fromEnv ? 'environment' : fromFile ? 'config-file' : null,
      hint: apiKey ? apiKey.slice(-4) : null,
      protection: saved ? this.saved.protection() : null
    }
  }

  save(apiKey: string): void {
    this.saved.save(apiKey.trim())
  }

  /** Forgets what Settings saved; a key in the environment or the config file keeps working. */
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

/** OpenRouter's public catalog: every model that answers in text only, free ones first. */
export async function listOpenRouterModels(
  options: {
    apiKey?: string | null
    signal?: AbortSignal
    fetchImpl?: UtilityModelFetch
    baseUrl?: string
  } = {}
): Promise<UtilityModelCatalogEntry[]> {
  const body = await requestOpenAiCompatibleJson({
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
    // A model that also returns audio or images is no fit for a one-line text chore.
    if (!id || (Array.isArray(output) && output.some((kind) => kind !== 'text'))) {
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
  const chat = createOpenAiCompatibleProvider(
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
  return {
    ...chat,
    /** `body` is the Decisions request whole: `model`, `state`, the typed `questions`, any routing. */
    async decide(model, request, signal) {
      const body = record(
        await requestOpenAiCompatibleJson({
          label: 'OpenRouter',
          url: OPENROUTER_DECISIONS_URL,
          apiKey,
          body: request.body,
          model,
          timeoutMs: request.timeoutMs,
          signal,
          fetchImpl: options.fetchImpl
        })
      )
      // One typed answer per question id; a question the host declined is `{ type: 'refusal' }`.
      const answers = record(body?.answers)
      if (answers === null) {
        throw new UtilityModelError('bad-response', 'OpenRouter answered without any answers', {
          model
        })
      }
      const tokens = record(body?.usage)?.input_tokens
      return {
        answers,
        inputTokens: typeof tokens === 'number' && Number.isFinite(tokens) ? tokens : null
      }
    }
  }
}
