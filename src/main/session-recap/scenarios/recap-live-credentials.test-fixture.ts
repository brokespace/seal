// The Workers AI credential a live run uses: the environment, else this host's config file. Never printed.
import { CloudflareAiConfigStore } from '../../utility-model/cloudflare-ai-config'
import type { CloudflareAiCredentials } from '../../utility-model/cloudflare-workers-ai-provider'

export async function liveRecapCredentials(): Promise<CloudflareAiCredentials> {
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
