import {
  claudePluginSkillFolders,
  codexPluginSkillFolders,
  CURSOR_INSTALLED_MARK_PATTERN,
  cursorPluginSkillFolders,
  latestPluginVersion,
  PLUGIN_SKILL_FILE_NAMES,
  pluginSkills,
  type PluginSkillFolder
} from '../../shared/agent-config/agent-config-plugin-skills'
import type {
  AgentConfigDocRef,
  AgentConfigPluginsState
} from '../../shared/agent-config/agent-config-types'
import type { MachineConnection } from '../machines/connection/machine-connection'
import {
  scanMachineFiles,
  SKILL_SCAN_SKIP_DIRS,
  type MachineFileScanRecord
} from '../machines/scan/machine-file-scan'
import { bundledSkillFromRecord } from './agent-config-doc-refs'
import { scanRunner } from './agent-config-file-io'
import { joinRelative, type ResolvedTarget } from './agent-config-locations'

/** Deep enough for `<version>/<declared folder>/<group>/<skill>/SKILL.md` under a plugin. */
const PLUGIN_SCAN_DEPTH = 7
/** Cursor's cache adds `<marketplace>/<plugin>/<version>` above each plugin. */
const CURSOR_CACHE_SCAN_DEPTH = 8

export type PluginSkillInputs = {
  /** Claude Code's registry, with each marketplace's plugin list. */
  claude: { state: AgentConfigPluginsState; manifests: Record<string, unknown> } | null
  /** The account's parsed settings file; Codex lists its plugins there. */
  userSettings: Record<string, unknown> | null
}

/**
 * The skills inside the plugins this agent loads. Which folders to look in is only known once
 * the agent's plugin registry has been read, so this is a second trip to the machine.
 */
export async function readPluginSkills(
  connection: MachineConnection,
  resolved: ResolvedTarget,
  inputs: PluginSkillInputs,
  headBytes: number
): Promise<AgentConfigDocRef[]> {
  const { layout, home, projectRoot } = resolved
  const registry = layout.skills.plugins
  const cursorCache = joinRelative(home, '.cursor/plugins/cache')
  const known: PluginSkillFolder[] =
    registry === 'claude' && inputs.claude
      ? claudePluginSkillFolders(inputs.claude.state, inputs.claude.manifests, projectRoot !== null)
      : registry === 'codex'
        ? codexPluginSkillFolders(inputs.userSettings, joinRelative(home, '.codex/plugins/cache'))
        : []
  const roots = registry === 'cursor' ? [cursorCache] : known.map((folder) => folder.root)
  if (roots.length === 0) {
    return []
  }
  const scan = await scanMachineFiles(await scanRunner(connection), {
    named: roots.map((root, index) => ({
      tag: `p${index}`,
      root,
      names:
        registry === 'cursor'
          ? [...PLUGIN_SKILL_FILE_NAMES, CURSOR_INSTALLED_MARK_PATTERN]
          : PLUGIN_SKILL_FILE_NAMES,
      maxDepth: registry === 'cursor' ? CURSOR_CACHE_SCAN_DEPTH : PLUGIN_SCAN_DEPTH,
      skipDirs: SKILL_SCAN_SKIP_DIRS,
      followLinks: true,
      includeHidden: true
    })),
    headBytes
  })
  const tagged = (index: number): MachineFileScanRecord[] =>
    scan.records.filter((record) => record.tag === `p${index}`)
  const found: { folder: PluginSkillFolder; records: MachineFileScanRecord[] }[] =
    registry === 'cursor'
      ? cursorPluginSkillFolders(cursorCache, tagged(0)).map((folder) => ({
          folder,
          records: tagged(0)
        }))
      : known.map((folder, index) => ({
          // Codex's cache keeps a folder per version above the plugin itself.
          folder: registry === 'codex' ? latestPluginVersion(folder, tagged(index)) : folder,
          records: tagged(index)
        }))
  return found.flatMap(({ folder, records }) => {
    const { bundle, skills } = pluginSkills(folder, records)
    return skills.map((record) => bundledSkillFromRecord(record, bundle, headBytes))
  })
}
