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
  'mcp',
  'plugins',
  'marketplace',
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
        'auto.components.agentConfig.search.description',
        'Instructions, skills, MCP servers, plugins and settings for Claude Code, Codex and other agents.'
      ),
      // File and product names are typed as they are written, in any language.
      keywords: [...(scope ? [scope] : []), ...KEYWORDS]
    }
  ]
}
