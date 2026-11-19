import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  AGENT_PLUGIN_LEDGER_PATH,
  parseAgentPluginLedger,
  pluginForSkillDirectory
} from '../../../shared/agent-plugins/agent-plugin-ledger'
import type { DiscoveredSkill } from '../../../shared/skills'

/** Skills the Agent plugins hub linked into an agent's folder are listed as their plugin's. */
export async function withAgentPluginSkillOrigins(
  skills: DiscoveredSkill[],
  homeDir: string
): Promise<DiscoveredSkill[]> {
  const text = await readFile(join(homeDir, ...AGENT_PLUGIN_LEDGER_PATH.split('/')), 'utf8').catch(
    () => null
  )
  if (text === null) {
    return skills
  }
  let ledger
  try {
    ledger = parseAgentPluginLedger(JSON.parse(text))
  } catch {
    return skills
  }
  return skills.map((skill) => {
    const origin = pluginForSkillDirectory(ledger, skill.directoryPath)
    return origin
      ? { ...skill, sourceKind: 'plugin', sourceLabel: `Agent plugin ${origin.name}` }
      : skill
  })
}
