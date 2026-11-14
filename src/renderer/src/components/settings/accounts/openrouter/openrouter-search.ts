import { translate } from '@/i18n/i18n'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'
import type { SettingsSearchEntry } from '../../search/settings-search'
import { translateSearchKeyword } from '../../search/settings-search-keywords'

export const OPENROUTER_SECTION_ID = 'accounts-openrouter'

export const OPENROUTER_SEARCH_KEYWORDS = [
  'openrouter',
  'api key',
  'free models',
  'summary',
  'summaries',
  'recap',
  'utility model'
]

export const getOpenRouterSearchEntries = createLocalizedCatalog((): SettingsSearchEntry[] => [
  {
    title: translate('seal.openRouter.search.title', 'OpenRouter'),
    description: translate(
      'seal.openRouter.search.description',
      'Save an OpenRouter API key that session summaries and recaps can run on, including its free models.'
    ),
    keywords: [
      ...translateSearchKeyword('seal.openRouter.search.kw.openrouter', 'openrouter'),
      ...translateSearchKeyword('seal.openRouter.search.kw.apiKey', 'api key'),
      ...translateSearchKeyword('seal.openRouter.search.kw.free', 'free models'),
      ...translateSearchKeyword('seal.cloudflareAi.search.kw.summary', 'summary'),
      ...translateSearchKeyword('seal.cloudflareAi.search.kw.summaries', 'summaries'),
      ...translateSearchKeyword('seal.cloudflareAi.search.kw.recap', 'recap')
    ]
  }
])
