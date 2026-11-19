import { parseJsonObject } from '../../shared/agent-config/agent-config-json-edit'
import { newestPluginVersion } from '../../shared/agent-config/agent-config-plugin-skills'
import { parseTomlObject } from '../../shared/agent-config/agent-config-toml-edit'
import { isPlainObject } from '../../shared/agent-config/agent-config-values'
import { splitAgentPluginId } from '../../shared/agent-plugins/agent-plugin-catalog'
import { joinMachinePath } from '../../shared/machines/machine-paths'
import type { MachineConnection } from '../machines/connection/machine-connection'
import { joinRelative } from '../agent-config/agent-config-locations'

const MAX_REGISTRY_BYTES = 8 * 1024 * 1024

export type AgentPluginInstallRoot = { root: string; version: string | null }

async function readRegistry(
  connection: MachineConnection,
  path: string,
  format: 'json' | 'toml'
): Promise<Record<string, unknown>> {
  const read = await connection.files.readFile(path, MAX_REGISTRY_BYTES).catch(() => null)
  if (!read) {
    return {}
  }
  const text = read.data.toString('utf8')
  const parsed = format === 'toml' ? parseTomlObject(text) : parseJsonObject(text)
  return parsed.ok ? parsed.value : {}
}

/** Claude Code's account-wide installs under one config dir: id to folder, from `installed_plugins.json`. */
export async function readClaudeInstallRoots(
  connection: MachineConnection,
  claudeConfigDir: string
): Promise<Map<string, AgentPluginInstallRoot>> {
  const registry = await readRegistry(
    connection,
    joinRelative(claudeConfigDir, 'plugins/installed_plugins.json'),
    'json'
  )
  const plugins = isPlainObject(registry.plugins) ? registry.plugins : {}
  const installs = new Map<string, AgentPluginInstallRoot>()
  for (const [id, value] of Object.entries(plugins)) {
    const list = Array.isArray(value) ? value : [value]
    const user = list.find(
      (install) => isPlainObject(install) && (install.scope ?? 'user') === 'user'
    )
    if (isPlainObject(user) && typeof user.installPath === 'string') {
      installs.set(id, {
        root: user.installPath,
        version: typeof user.version === 'string' ? user.version : null
      })
    }
  }
  return installs
}

/** Codex lists installed plugins as `[plugins."name@marketplace"]` in its config; the value is on/off. */
export async function readCodexInstalls(
  connection: MachineConnection,
  codexHome: string
): Promise<Map<string, boolean>> {
  const config = await readRegistry(connection, joinRelative(codexHome, 'config.toml'), 'toml')
  const plugins = isPlainObject(config.plugins) ? config.plugins : {}
  return new Map(
    Object.entries(plugins).map(([id, value]) => [
      id,
      !isPlainObject(value) || value.enabled !== false
    ])
  )
}

/** Codex unpacks each version under `plugins/cache/<marketplace>/<name>/<version>`. */
export async function readCodexInstallRoot(
  connection: MachineConnection,
  codexHome: string,
  id: string
): Promise<AgentPluginInstallRoot | null> {
  const { name, marketplace } = splitAgentPluginId(id)
  const base = joinRelative(codexHome, `plugins/cache/${marketplace}/${name}`)
  const entries = await connection.files.listDir(base).catch(() => [])
  const version = newestPluginVersion(
    entries.filter((entry) => entry.isDirectoryLike).map((entry) => entry.name)
  )
  return version ? { root: joinMachinePath(base, version), version } : null
}
