import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'
import type { SettingsSearchEntry } from '../search/settings-search'

const KEYWORDS = [
  'plugins',
  'marketplace',
  'install',
  'browse',
  'skills',
  'claude plugin',
  'codex plugin',
  'connectors'
]

export function getAgentPluginsSearchEntries(t: Translate = translate): SettingsSearchEntry[] {
  return [
    {
      title: t('seal.plugins.title', 'Plugins'),
      description: t(
        'seal.plugins.description',
        'Install a plugin from Claude Code’s or Codex’s marketplaces once for every agent, account and machine.'
      ),
      keywords: KEYWORDS
    }
  ]
}
