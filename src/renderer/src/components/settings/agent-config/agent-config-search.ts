import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'
import type { SettingsSearchEntry } from '../search/settings-search'

const KEYWORDS = [
  'claude',
  'codex',
  'CLAUDE.md',
  'AGENTS.md',
  'skills',
  'subagents',
  'slash commands',
  'hooks',
  'permissions',
  'settings.json',
  'config.toml'
]

/** One entry serves the machine-wide page and each project's section; `scope` names the project. */
export function getAgentConfigSearchEntries(
  scope?: string,
  t: Translate = translate
): SettingsSearchEntry[] {
  return [
    {
      title: t('auto.components.agentConfig.search.title', 'Agent configuration'),
      description: t(
        'seal.agentConfig.search.description',
        'Instructions, skills and settings for Claude Code, Codex and other agents, machine by machine.'
      ),
      // File and product names are typed as they are written, in any language.
      keywords: [...(scope ? [scope] : []), ...KEYWORDS]
    }
  ]
}
