import { pluginForSkillDirectory } from '../../../shared/agent-plugins/agent-plugin-ledger'
import type { DiscoveredSkill } from '../../../shared/skills'
import { readLocalAgentPluginLedger } from '../../agent-plugins/agent-plugin-ledger-io'

/** Skills the Agent plugins hub linked into an agent's folder are listed as their plugin's. */
export async function withAgentPluginSkillOrigins(
  skills: DiscoveredSkill[],
  homeDir: string
): Promise<DiscoveredSkill[]> {
  const ledger = await readLocalAgentPluginLedger(homeDir)
  if (!ledger) {
    return skills
  }
  return skills.map((skill) => {
    const origin = pluginForSkillDirectory(ledger, skill.directoryPath)
    return origin
      ? { ...skill, sourceKind: 'plugin', sourceLabel: `Agent plugin ${origin.name}` }
      : skill
  })
}
