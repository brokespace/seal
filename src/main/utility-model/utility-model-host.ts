import type { UtilityModelStatus } from '../../shared/utility-model/utility-model-types'
import { CloudflareAiConfigStore, type CloudflareAiConfigFields } from './cloudflare-ai-config'
import { createCloudflareWorkersAiProvider } from './cloudflare-workers-ai-provider'
import { UtilityModelService } from './utility-model-service'

/** This host's utility model: its saved Cloudflare config and the service every feature calls through. */
export class UtilityModelHost {
  readonly service: UtilityModelService

  constructor(private readonly config = new CloudflareAiConfigStore()) {
    this.service = new UtilityModelService({
      backend: async () => {
        const { credentials, model, fallbackModel } = await this.config.load()
        return credentials
          ? {
              provider: createCloudflareWorkersAiProvider(credentials),
              models: [model, fallbackModel]
            }
          : null
      }
    })
  }

  async status(): Promise<UtilityModelStatus> {
    const config = await this.config.load()
    return {
      provider: 'cloudflare-workers-ai',
      configured: config.credentials !== null,
      source: config.source,
      accountHint: config.credentials ? config.credentials.accountId.slice(-4) : null,
      tokenProtection: config.tokenProtection,
      model: config.model,
      fallbackModel: config.fallbackModel,
      ...this.service.health()
    }
  }

  async setCloudflare(fields: CloudflareAiConfigFields): Promise<UtilityModelStatus> {
    this.config.save(fields)
    this.service.configChanged()
    return await this.status()
  }

  async clearCloudflare(): Promise<UtilityModelStatus> {
    this.config.clear()
    this.service.configChanged()
    return await this.status()
  }
}

let host: UtilityModelHost | null = null

/** One per process, made on first use: the desktop and a headless server both have one. */
export function getUtilityModelHost(): UtilityModelHost {
  host ??= new UtilityModelHost()
  return host
}
