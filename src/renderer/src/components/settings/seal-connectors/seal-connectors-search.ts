import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'
import type { SettingsSearchEntry } from '../search/settings-search'

const CONNECTOR_KEYWORDS = [
  'connectors',
  'mcp',
  'mcp servers',
  'sign-in',
  'oauth',
  'refresher',
  'slack',
  'atlassian',
  'jira',
  'codegraph',
  'applies to',
  'project overrides'
]

const SKILL_KEYWORDS = ['skills', 'skill', 'plugin skills', 'library', 'applies to']

export function getSealConnectorsSearchEntries(t: Translate = translate): SettingsSearchEntry[] {
  return [
    {
      title: t('seal.connectors.title', 'Connectors'),
      description: t(
        'seal.connectors.description',
        'MCP servers every agent session gets, with one sign-in per service shared across machines and accounts.'
      ),
      keywords: CONNECTOR_KEYWORDS
    }
  ]
}

export function getSealSkillsSearchEntries(t: Translate = translate): SettingsSearchEntry[] {
  return [
    {
      title: t('seal.skills.title', 'Skills'),
      description: t(
        'seal.skills.navDescription',
        'Skills from plugins and the Seal library, and which agents get each.'
      ),
      keywords: SKILL_KEYWORDS
    }
  ]
}
