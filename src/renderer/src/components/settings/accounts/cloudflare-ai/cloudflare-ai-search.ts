import { translate } from '@/i18n/i18n'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'
import type { SettingsSearchEntry } from '../../search/settings-search'
import { translateSearchKeyword } from '../../search/settings-search-keywords'

export const CLOUDFLARE_AI_SECTION_ID = 'accounts-cloudflare-ai'

export const CLOUDFLARE_AI_SEARCH_KEYWORDS = [
  'cloudflare',
  'workers ai',
  'summary',
  'summaries',
  'utility model',
  'api token',
  'account id',
  'glm',
  'gemma'
]

export const getCloudflareAiSearchEntries = createLocalizedCatalog((): SettingsSearchEntry[] => [
  {
    title: translate('seal.cloudflareAi.search.title', 'Cloudflare AI'),
    description: translate(
      'seal.cloudflareAi.search.description',
      'Link a Cloudflare Workers AI account for session summaries. Pick the model and turn summaries on or off.'
    ),
    keywords: [
      ...translateSearchKeyword('seal.cloudflareAi.search.kw.cloudflare', 'cloudflare'),
      ...translateSearchKeyword('seal.cloudflareAi.search.kw.workersAi', 'workers ai'),
      ...translateSearchKeyword('seal.cloudflareAi.search.kw.summary', 'summary'),
      ...translateSearchKeyword('seal.cloudflareAi.search.kw.summaries', 'summaries'),
      ...translateSearchKeyword('seal.cloudflareAi.search.kw.model', 'model'),
      ...translateSearchKeyword('seal.cloudflareAi.search.kw.apiToken', 'api token')
    ]
  }
])
