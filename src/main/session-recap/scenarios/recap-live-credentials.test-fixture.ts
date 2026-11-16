// The Workers AI credential a live run uses: the environment, else this host's config file. Never printed.
import { CLOUDFLARE_AI_DEFAULT_MODEL } from '../../../shared/utility-model/utility-model-types'
import { CloudflareAiConfigStore } from '../../utility-model/cloudflare-ai-config'
import type { CloudflareAiCredentials } from '../../utility-model/cloudflare-workers-ai-provider'
import {
  jsonRecord,
  jsonText,
  requestUtilityModelJson
} from '../../utility-model/utility-model-http-request'

let checked: Promise<CloudflareAiCredentials> | undefined

/** The credential, once Workers AI has answered one small request with it: a live run rewrites recordings. */
export function liveRecapCredentials(): Promise<CloudflareAiCredentials> {
  checked ??= foundRecapCredentials().then(async (credentials) => {
    const { response, body } = await requestUtilityModelJson({
      fetchImpl: (url, init) => fetch(url, init),
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
    return credentials
  })
  return checked
}

async function foundRecapCredentials(): Promise<CloudflareAiCredentials> {
  const env = process.env
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim()
  const apiToken = (env.CLOUDFLARE_API_TOKEN ?? env.CLOUDFLARE_AUTH_TOKEN)?.trim()
  if (accountId && apiToken) {
    return { accountId, apiToken }
  }
  // Settings' sealed store belongs to the desktop app: a live run reads the config file only.
  const store = new CloudflareAiConfigStore({
    saved: {
      read: () => null,
      save: () => undefined,
      clear: () => undefined,
      protection: () => null
    }
  })
  const found = (await store.load()).credentials
  if (!found) {
    throw new Error(
      'A live run needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN, or ~/.config/seal/cloudflare-ai.json'
    )
  }
  return found
}
