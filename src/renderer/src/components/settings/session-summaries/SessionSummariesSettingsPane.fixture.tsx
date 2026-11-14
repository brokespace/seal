import { defineFixture } from '../../../component-fixtures/component-fixture'
import type { SessionSummariesStatus } from '../../../../../shared/session-summaries/session-summary-contracts'
import type { SessionSummaryModels } from '../../../../../shared/utility-model/utility-model-selection'
import { LOCAL_USAGE_CREDENTIAL_HOST } from '../accounts/usage/usage-credential-host'
import {
  fixtureProviderStatuses,
  stubUtilityModelFixtureHost
} from '../accounts/utility-model/utility-model-fixture-host'
import { SessionSummariesSettingsPane } from './SessionSummariesSettingsPane'

const PROVIDERS = fixtureProviderStatuses({
  'cloudflare-workers-ai': {
    configured: true,
    source: 'settings',
    accountHint: '9f3c',
    tokenProtection: 'sealed'
  },
  openrouter: { configured: true, source: 'settings', accountHint: 'a41c' },
  claude: { configured: true, source: 'agent-cli' },
  codex: { configured: true, source: 'agent-cli' }
})

const OPENROUTER_MODELS = [
  { id: 'openrouter/free', description: 'Free Models Router', free: true },
  {
    id: 'google/gemma-4-26b-a4b-it:free',
    description: 'Google: Gemma 4 26B A4B (free)',
    free: true
  },
  { id: 'nvidia/nemotron-3-nano-30b-a3b:free', description: 'NVIDIA: Nemotron 3 Nano', free: true },
  { id: 'anthropic/claude-haiku-4.5', description: 'Anthropic: Claude Haiku 4.5' },
  { id: 'openai/gpt-5.4-mini', description: 'OpenAI: GPT-5.4 Mini' }
]

function host(models: SessionSummaryModels | undefined, configured = true): () => void {
  const summaries: SessionSummariesStatus = {
    enabled: true,
    recapEnabled: true,
    configured,
    recapConfigured: configured,
    pausedUntil: null,
    recapPausedUntil: null,
    models
  }
  return stubUtilityModelFixtureHost({
    providers: PROVIDERS,
    summaries,
    catalogs: { openrouter: OPENROUTER_MODELS }
  })
}

const render = () => (
  <div className="flex flex-col gap-8 p-4">
    <SessionSummariesSettingsPane host={LOCAL_USAGE_CREDENTIAL_HOST} />
  </div>
)

/** A host that never chose: Cloudflare Workers AI with the models saved beside its account. */
export const defaults = defineFixture({ width: 760, setup: host(undefined), render })

export const openRouterFreeModel = defineFixture({
  width: 760,
  setup: host({
    summaries: {
      provider: 'openrouter',
      model: 'google/gemma-4-26b-a4b-it:free',
      fallbackModel: null
    },
    recaps: null
  }),
  render
})

export const openRouterModelPicker = defineFixture({
  width: 760,
  setup: host({
    summaries: { provider: 'openrouter', model: null, fallbackModel: null },
    recaps: null
  }),
  render,
  interact: async (frame) => {
    const trigger = Array.from(frame.querySelectorAll<HTMLElement>('[role="combobox"]')).find(
      (element) => element.getAttribute('aria-label') === 'Model'
    )
    trigger?.click()
  }
})

/** Summaries on a cheap API model, recaps on the Claude CLI subscription. */
export const separateRecapModel = defineFixture({
  width: 760,
  setup: host({
    summaries: { provider: 'cloudflare-workers-ai', model: null, fallbackModel: null },
    recaps: { provider: 'claude', model: 'sonnet', fallbackModel: 'haiku' }
  }),
  render
})

export const providerNotSetUp = defineFixture({
  width: 760,
  setup: host(
    { summaries: { provider: 'minimax', model: null, fallbackModel: null }, recaps: null },
    false
  ),
  render
})
