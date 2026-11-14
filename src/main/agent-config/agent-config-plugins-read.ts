import { parseJsonObject } from '../../shared/agent-config/agent-config-json-edit'
import { buildPluginsState } from '../../shared/agent-config/agent-config-plugins-state'
import type {
  AgentConfigPluginsState,
  AgentConfigScope
} from '../../shared/agent-config/agent-config-types'
import { isPlainObject } from '../../shared/agent-config/agent-config-values'
import type { MachineConnection } from '../machines/connection/machine-connection'
import { joinRelative } from './agent-config-locations'

const MAX_MANIFEST_BYTES = 8 * 1024 * 1024

type ParsedFile = { value: Record<string, unknown> | null }

/** Claude Code's plugin registry on the machine, read from the files `claude plugin` maintains. */
export async function readPluginsState(
  connection: MachineConnection,
  home: string,
  parsedAt: (path: string) => Promise<ParsedFile>,
  settings: { scope: AgentConfigScope; value: Record<string, unknown> | null }[],
  projectRoot: string | null
): Promise<AgentConfigPluginsState> {
  const pluginsDir = joinRelative(home, '.claude/plugins')
  const [installed, known] = await Promise.all([
    parsedAt(joinRelative(pluginsDir, 'installed_plugins.json')),
    parsedAt(joinRelative(pluginsDir, 'known_marketplaces.json'))
  ])
  const manifests: Record<string, unknown> = {}
  await Promise.all(
    Object.entries(known.value ?? {}).map(async ([name, record]) => {
      const location =
        isPlainObject(record) && typeof record.installLocation === 'string'
          ? record.installLocation
          : ''
      const read = location
        ? await connection.files
            .readFile(joinRelative(location, '.claude-plugin/marketplace.json'), MAX_MANIFEST_BYTES)
            .catch(() => null)
        : null
      const parsed = read ? parseJsonObject(read.data.toString('utf8')) : null
      if (parsed?.ok) {
        manifests[name] = parsed.value
      }
    })
  )
  return buildPluginsState({
    installed: installed.value,
    marketplaces: known.value,
    manifests,
    settings,
    ...(projectRoot ? { projectPath: projectRoot } : {})
  })
}
