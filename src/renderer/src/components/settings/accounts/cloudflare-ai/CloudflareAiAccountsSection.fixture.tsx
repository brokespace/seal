import { defineFixture } from '../../../../component-fixtures/component-fixture'
import type { SessionSummariesStatus } from '../../../../../../shared/session-summaries/session-summary-contracts'
import type { UtilityModelStatus } from '../../../../../../shared/utility-model/utility-model-types'
import { LOCAL_USAGE_CREDENTIAL_HOST } from '../usage/usage-credential-host'
import { CloudflareAiAccountsSection } from './CloudflareAiAccountsSection'

const NOW = Date.now()

const LINKED: UtilityModelStatus = {
  provider: 'cloudflare-workers-ai',
  configured: true,
  source: 'settings',
  accountHint: '9f3c',
  tokenProtection: 'sealed',
  model: '@cf/zai-org/glm-4.7-flash',
  fallbackModel: '@cf/google/gemma-4-26b-a4b-it',
  unavailableModels: [],
  pausedUntil: null,
  lastFailure: null
}

const MODELS = [
  '@cf/zai-org/glm-4.7-flash',
  '@cf/zai-org/glm-5.3-flash',
  '@cf/google/gemma-4-26b-a4b-it',
  '@cf/deepseek/deepseek-v4-flash'
].map((id) => ({ id, description: null }))

function withHost(status: UtilityModelStatus) {
  const summaries: SessionSummariesStatus = {
    enabled: true,
    configured: status.configured,
    pausedUntil: status.pausedUntil
  }
  return (): void => {
    window.api.runtime = {
      ...window.api.runtime,
      call: async ({ method }) => {
        const result =
          method === 'utilityModel.status'
            ? status
            : method === 'utilityModel.listModels'
              ? { ok: true, models: MODELS }
              : summaries
        return { id: 'fixture', ok: true, result, _meta: { runtimeId: 'fixture' } }
      }
    }
  }
}

const render = () => (
  <div className="p-4">
    <CloudflareAiAccountsSection host={LOCAL_USAGE_CREDENTIAL_HOST} />
  </div>
)

export const linked = defineFixture({ width: 760, setup: withHost(LINKED), render })

export const notLinked = defineFixture({
  width: 760,
  setup: withHost({
    ...LINKED,
    configured: false,
    source: null,
    accountHint: null,
    tokenProtection: null
  }),
  render
})

/** A model the free plan refuses falls back; a spent daily allocation pauses until the next UTC day. */
export const freePlanLimits = defineFixture({
  width: 760,
  setup: withHost({
    ...LINKED,
    source: 'config-file',
    tokenProtection: null,
    model: '@cf/zai-org/glm-5.3-flash',
    unavailableModels: [
      {
        kind: 'plan-unavailable',
        message: 'This model is not available on the Workers Free plan.',
        model: '@cf/zai-org/glm-5.3-flash',
        at: NOW
      }
    ],
    pausedUntil: new Date(NOW).setUTCHours(24, 0, 0, 0)
  }),
  render
})
