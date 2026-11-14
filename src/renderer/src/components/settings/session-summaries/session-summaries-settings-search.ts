import { translate } from '@/i18n/i18n'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'
import type { SettingsSearchEntry } from '../search/settings-search'
import { translateSearchKeyword } from '../search/settings-search-keywords'

export const SESSION_SUMMARIES_SETTINGS_PANE_ID = 'session-summaries'

export const SESSION_SUMMARIES_SEARCH_KEYWORDS = [
  'summary',
  'summaries',
  'recap',
  'provider',
  'model',
  'utility model',
  'openrouter',
  'cloudflare',
  'claude',
  'codex',
  'devin',
  'antigravity',
  'minimax',
  'grok'
]

export const getSessionSummariesSettingsSearchEntries = createLocalizedCatalog(
  (): SettingsSearchEntry[] => [
    {
      title: translate('seal.sessionSummaries.setting.title', 'Session summaries'),
      description: translate(
        'seal.sessionSummaries.setting.searchDescription',
        'Show a one-line AI summary on agent sessions.'
      ),
      keywords: [
        ...translateSearchKeyword('seal.cloudflareAi.search.kw.summary', 'summary'),
        ...translateSearchKeyword('seal.cloudflareAi.search.kw.summaries', 'summaries')
      ]
    },
    {
      title: translate('seal.sessionRecap.setting.title', 'Session recaps'),
      description: translate(
        'seal.sessionRecap.setting.searchDescription',
        'Keep a recap of each agent session: goal, open questions, action items.'
      ),
      keywords: [...translateSearchKeyword('seal.cloudflareAi.search.kw.recap', 'recap')]
    },
    {
      title: translate('seal.summaryModels.search.title', 'Summary and recap model'),
      description: translate(
        'seal.summaryModels.search.description',
        'Choose the provider and model that write session summaries and recaps: Cloudflare Workers AI, OpenRouter, MiniMax, or the Claude, Codex, Grok, Antigravity or Devin CLI.'
      ),
      keywords: [
        ...translateSearchKeyword('seal.summaryModels.search.kw.provider', 'provider'),
        ...translateSearchKeyword('seal.summaryModels.search.kw.model', 'model'),
        ...translateSearchKeyword('seal.summaryModels.search.kw.fallback', 'fallback'),
        ...translateSearchKeyword('seal.openRouter.search.kw.openrouter', 'openrouter'),
        ...translateSearchKeyword('seal.cloudflareAi.search.kw.cloudflare', 'cloudflare')
      ]
    }
  ]
)
