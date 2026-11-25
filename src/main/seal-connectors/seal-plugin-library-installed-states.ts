import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseJsonObject } from '../../shared/agent-config/agent-config-json-edit'
import { newestPluginVersion } from '../../shared/agent-config/agent-config-plugin-skills'
import { parseTomlObject } from '../../shared/agent-config/agent-config-toml-edit'
import { isPlainObject } from '../../shared/agent-config/agent-config-values'
import { splitAgentPluginId } from '../../shared/agent-plugins/agent-plugin-catalog'
import type { AgentPluginCli } from '../agent-config/agent-config-plugin-commands'
import { parseClaudeInstallRoots } from '../agent-plugins/agent-plugin-install-roots'

export type PluginState = { installed: boolean; path: string | null; error: string | null }

async function readObject(path: string, parse: (text: string) => Record<string, unknown> | null) {
  try {
    return parse(await readFile(path, 'utf8')) ?? {}
  } catch {
    return {}
  }
}

/** What the library's folders already hold, so plugin paths work before the first reconcile. */
export async function readInstalledPluginStates(
  homes: Record<AgentPluginCli, string>
): Promise<Map<string, PluginState>> {
  const states = new Map<string, PluginState>()
  const found = (path: string): PluginState => ({ installed: true, path, error: null })
  const claude = await readObject(
    join(homes.claude, 'plugins', 'installed_plugins.json'),
    (text) => {
      const parsed = parseJsonObject(text)
      return parsed.ok ? parsed.value : null
    }
  )
  for (const [id, install] of parseClaudeInstallRoots(claude)) {
    states.set(id, found(install.root))
  }
  const codex = await readObject(join(homes.codex, 'config.toml'), (text) => {
    const parsed = parseTomlObject(text)
    return parsed.ok ? parsed.value : null
  })
  for (const id of Object.keys(isPlainObject(codex.plugins) ? codex.plugins : {})) {
    const { name, marketplace } = splitAgentPluginId(id)
    const base = join(homes.codex, 'plugins', 'cache', marketplace, name)
    try {
      const version = newestPluginVersion(
        (await readdir(base, { withFileTypes: true }))
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
      )
      if (version) {
        states.set(id, found(join(base, version)))
      }
    } catch {
      // Not unpacked yet; the first reconcile fetches it.
    }
  }
  return states
}
