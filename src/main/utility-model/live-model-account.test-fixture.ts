// The account a live test run calls with: OpenRouter when this host has a key for it, else Workers AI.
// Read from the environment, else this host's config files. Never printed.
import { CLOUDFLARE_AI_DEFAULT_MODEL } from '../../shared/utility-model/utility-model-types'
import { createClefDecisions, type ClefDecisions } from './clef-decisions'
import { CloudflareAiConfigStore } from './cloudflare-ai-config'
import {
  createCloudflareWorkersAiProvider,
  type CloudflareAiCredentials
} from './cloudflare-workers-ai-provider'
import { requestOpenAiCompatibleJson } from './openai-compatible-utility-provider'
import {
  createOpenRouterProvider,
  OPENROUTER_API_ROOT,
  OpenRouterAccountStore
} from './openrouter-utility-provider'
import {
  jsonRecord,
  jsonText,
  requestUtilityModelJson,
  type UtilityModelFetch
} from './utility-model-http-request'
import { UtilityModelError, type UtilityModelProvider } from './utility-model-provider'

export type LiveModelAccount =
  | { provider: 'openrouter'; apiKey: string }
  | { provider: 'cloudflare-workers-ai'; credentials: CloudflareAiCredentials }

/** The network itself: a live run goes around the app's HTTP client, which a test has none of. */
export const liveModelFetch: UtilityModelFetch = (url, init) => fetch(url, init)

// Settings' sealed store belongs to the desktop app: a live run reads the environment and the config files only.
const NOT_SAVED = {
  read: () => null,
  save: () => undefined,
  clear: () => undefined,
  protection: () => null
}

let checked: Promise<LiveModelAccount> | undefined

/** The account, once its provider has taken the credential: a live run rewrites recordings. */
export function liveModelAccount(): Promise<LiveModelAccount> {
  checked ??= foundAccount()
  return checked
}

async function foundAccount(): Promise<LiveModelAccount> {
  const { apiKey } = await new OpenRouterAccountStore({ saved: NOT_SAVED }).load()
  if (apiKey) {
    await checkOpenRouterKey(apiKey)
    return { provider: 'openrouter', apiKey }
  }
  const env = process.env
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim()
  const apiToken = (env.CLOUDFLARE_API_TOKEN ?? env.CLOUDFLARE_AUTH_TOKEN)?.trim()
  const credentials =
    accountId && apiToken
      ? { accountId, apiToken }
      : (await new CloudflareAiConfigStore({ saved: NOT_SAVED }).load()).credentials
  if (!credentials) {
    throw new Error(
      'A live run needs OPENROUTER_API_KEY or ~/.config/seal/openrouter.json, or else CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN or ~/.config/seal/cloudflare-ai.json'
    )
  }
  await checkCloudflareCredentials(credentials)
  return { provider: 'cloudflare-workers-ai', credentials }
}

/** Asks OpenRouter about the key itself, which costs nothing. Only a refusal stops the run. */
async function checkOpenRouterKey(apiKey: string): Promise<void> {
  try {
    await requestOpenAiCompatibleJson({
      label: 'OpenRouter',
      url: `${OPENROUTER_API_ROOT}/key`,
      apiKey,
      fetchImpl: liveModelFetch
    })
  } catch (error) {
    if (error instanceof UtilityModelError && error.kind === 'unauthorized') {
      throw new Error('OpenRouter turned the key down. Nothing was recorded or rewritten.')
    }
  }
}

async function checkCloudflareCredentials(credentials: CloudflareAiCredentials): Promise<void> {
  const { response, body } = await requestUtilityModelJson({
    fetchImpl: liveModelFetch,
    provider: 'Cloudflare',
    url: `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(credentials.accountId)}/ai/run/${CLOUDFLARE_AI_DEFAULT_MODEL}`,
    init: {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Reply: ok' }], max_tokens: 4 })
    },
    apiKey: credentials.apiToken
  })
  if (!response.ok) {
    const errors = jsonRecord(body)?.errors
    const said = jsonText(jsonRecord(Array.isArray(errors) ? errors[0] : null)?.message) ?? ''
    throw new Error(
      `Workers AI turned the credential down (http-${response.status} ${said.replaceAll(credentials.accountId, '<account>')}). Nothing was recorded or rewritten.`
    )
  }
}

/** The app's own provider for the account, on the real network. */
export function liveModelProvider(account: LiveModelAccount): UtilityModelProvider {
  return account.provider === 'openrouter'
    ? createOpenRouterProvider(account.apiKey, { fetchImpl: liveModelFetch })
    : createCloudflareWorkersAiProvider(account.credentials, liveModelFetch)
}

/**
 * Clef as the app asks it, on the account alone and with no pause after a rate limit: what a live
 * judge test calls, whichever judge it measures.
 */
export function liveClefDecisions(account: LiveModelAccount): ClefDecisions {
  const provider = liveModelProvider(account)
  return createClefDecisions((id) => ({
    decide: async (model, request, signal) => {
      if (id !== provider.id || !provider.decide) {
        throw new UtilityModelError('not-configured', 'Not the account of this live run', { model })
      }
      return provider.decide(model, request, signal)
    }
  }))
}
