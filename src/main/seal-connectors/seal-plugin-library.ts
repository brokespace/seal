import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { parseJsonObject } from '../../shared/agent-config/agent-config-json-edit'
import { isPlainObject } from '../../shared/agent-config/agent-config-values'
import type {
  PluginEntry,
  SealConnectorsConfig,
  SkillEntry
} from '../../shared/seal-connectors/seal-connectors-types'
import { joinMachinePath } from '../../shared/machines/machine-paths'
import { joinRelative } from '../agent-config/agent-config-locations'
import { runAgentCli, type AgentPluginCli } from '../agent-config/agent-config-plugin-commands'
import {
  readClaudeInstallRoots,
  readCodexInstallRoot,
  readCodexInstalls
} from '../agent-plugins/agent-plugin-install-roots'
import { pathExists } from '../ipc/shell-owned-path-target'
import type { MachineConnection } from '../machines/connection/machine-connection'
import type { SealPluginLibrary } from './seal-connectors-host'
import { readInstalledPluginStates, type PluginState } from './seal-plugin-library-installed-states'

const SKILLS_PLUGIN = 'seal-skills'
const SKILLS_HASH_FILE = '.seal-skills-hash'
const MAX_KNOWN_BYTES = 2 * 1024 * 1024
/** Marketplaces every Claude Code install knows by name; a fresh library home starts with none. */
const BUILT_IN_CLAUDE_MARKETPLACES: Record<string, string> = {
  'claude-plugins-official': 'anthropics/claude-plugins-official'
}

/** The argument `claude plugin marketplace add` takes for a source in `known_marketplaces.json`. */
function marketplaceSourceArg(source: unknown): string | null {
  if (!isPlainObject(source)) {
    return null
  }
  const pick = (key: string): string | null =>
    typeof source[key] === 'string' && source[key] !== '' ? source[key] : null
  switch (source.source) {
    case 'github':
      return pick('repo')
    case 'git':
    case 'url':
      return pick('url')
    case 'directory':
    case 'file':
      return pick('path')
    default:
      return null
  }
}

async function readKnownMarketplaces(
  connection: MachineConnection,
  claudeConfigDir: string
): Promise<Record<string, unknown>> {
  const read = await connection.files
    .readFile(joinRelative(claudeConfigDir, 'plugins/known_marketplaces.json'), MAX_KNOWN_BYTES)
    .catch(() => null)
  const parsed = read ? parseJsonObject(read.data.toString('utf8')) : null
  return parsed?.ok ? parsed.value : {}
}

function skillFiles(skill: SkillEntry): { path: string; base64: string }[] {
  return skill.source.kind === 'library' ? skill.source.files : []
}

function safeRelative(path: string): string | null {
  const normalized = path.replaceAll('\\', '/').replace(/^(\.\/)+/, '')
  return normalized !== '' && !normalized.startsWith('/') && !normalized.split('/').includes('..')
    ? normalized
    : null
}

function librarySkillsOf(config: SealConnectorsConfig): SkillEntry[] {
  return config.skills.filter((skill) => skill.source.kind === 'library')
}

function skillsDigest(skills: readonly SkillEntry[]): string {
  const hash = createHash('sha256')
  for (const skill of skills) {
    hash.update(JSON.stringify([skill.name, skill.description, skillFiles(skill)]))
  }
  return hash.digest('hex')
}

/**
 * This host's Seal plugin library: plugins are fetched once by the agents' own CLIs into folders
 * Seal owns, so no account or machine config ever holds a plugin install.
 */
export function createSealPluginLibrary(deps: {
  userData: string
  connection: MachineConnection
}): SealPluginLibrary {
  const { connection } = deps
  const root = join(deps.userData, 'seal-connectors', 'plugins')
  const homes: Record<AgentPluginCli, string> = {
    claude: join(root, 'claude-home'),
    codex: join(root, 'codex-home')
  }
  const envName: Record<AgentPluginCli, string> = {
    claude: 'CLAUDE_CONFIG_DIR',
    codex: 'CODEX_HOME'
  }
  const skillsDir = join(root, SKILLS_PLUGIN)
  let states = new Map<string, PluginState>()
  const pending = new Set<string>()
  let hasSkillsPlugin = false
  // Plugin paths work before the first reconcile, so reconciles and `ready()` wait for this.
  const loaded = Promise.all([
    readInstalledPluginStates(homes),
    pathExists(join(skillsDir, '.claude-plugin', 'plugin.json'))
  ])
    .then(([found, skillsFound]) => {
      states = found
      hasSkillsPlugin = skillsFound
    })
    .catch(() => {})
  let queue: Promise<void> = loaded

  const run = (cli: AgentPluginCli, argv: string[]) =>
    runAgentCli(connection, cli, argv, { env: { [envName[cli]]: homes[cli] } })

  async function ensureClaudeMarketplace(marketplace: string): Promise<string | null> {
    const known = await readKnownMarketplaces(connection, homes.claude)
    if (Object.hasOwn(known, marketplace)) {
      return null
    }
    // Read-only: the agent's own default home tells where a marketplace comes from.
    const home = await connection.files.homeDir()
    const defaults = await readKnownMarketplaces(connection, joinMachinePath(home, '.claude'))
    const entry = defaults[marketplace]
    const source =
      marketplaceSourceArg(isPlainObject(entry) ? entry.source : null) ??
      BUILT_IN_CLAUDE_MARKETPLACES[marketplace] ??
      null
    if (!source) {
      return `Claude Code does not know the "${marketplace}" marketplace on this machine`
    }
    const added = await run('claude', ['plugin', 'marketplace', 'add', source])
    return added.ok ? null : `Could not add the "${marketplace}" marketplace: ${added.output}`
  }

  async function reconcileClaude(
    plugins: readonly PluginEntry[],
    out: Map<string, PluginState>
  ): Promise<void> {
    const wanted = new Set([...plugins.map((plugin) => plugin.id), ...pending])
    let roots = await readClaudeInstallRoots(connection, homes.claude)
    for (const plugin of plugins) {
      if (roots.has(plugin.id)) {
        continue
      }
      const missing = await ensureClaudeMarketplace(plugin.marketplace)
      const installed = missing
        ? null
        : await run('claude', ['plugin', 'install', plugin.id, '--scope', 'user'])
      if (missing || !installed?.ok) {
        out.set(plugin.id, {
          installed: false,
          path: null,
          error: missing ?? installed?.output ?? 'Install failed'
        })
        continue
      }
      roots = await readClaudeInstallRoots(connection, homes.claude)
    }
    for (const id of roots.keys()) {
      if (!wanted.has(id)) {
        await run('claude', ['plugin', 'uninstall', id, '--scope', 'user'])
      }
    }
    for (const plugin of plugins) {
      const found = roots.get(plugin.id)
      const failure = out.get(plugin.id)?.error ?? null
      out.set(plugin.id, {
        installed: Boolean(found),
        path: found?.root ?? null,
        error: found ? null : (failure ?? 'Claude Code did not install this plugin')
      })
    }
  }

  async function reconcileCodex(
    plugins: readonly PluginEntry[],
    out: Map<string, PluginState>
  ): Promise<void> {
    const wanted = new Set([...plugins.map((plugin) => plugin.id), ...pending])
    for (const plugin of plugins) {
      let found = await readCodexInstallRoot(connection, homes.codex, plugin.id)
      let error: string | null = null
      if (!found) {
        const added = await run('codex', ['plugin', 'add', plugin.id])
        if (added.ok) {
          found = await readCodexInstallRoot(connection, homes.codex, plugin.id)
        } else {
          error = `Codex plugins need the marketplace on this machine; Codex could not install ${plugin.id}: ${added.output}`
        }
      }
      out.set(plugin.id, {
        installed: Boolean(found),
        path: found?.root ?? null,
        error: found ? null : (error ?? 'Codex did not install this plugin')
      })
    }
    const installed = await readCodexInstalls(connection, homes.codex)
    for (const id of installed.keys()) {
      if (!wanted.has(id)) {
        await run('codex', ['plugin', 'remove', id])
      }
    }
  }

  async function writeSkillsPlugin(skills: readonly SkillEntry[]): Promise<void> {
    if (skills.length === 0) {
      await rm(skillsDir, { recursive: true, force: true })
      hasSkillsPlugin = false
      return
    }
    const digest = skillsDigest(skills)
    const current = await readFile(join(skillsDir, SKILLS_HASH_FILE), 'utf8').catch(() => null)
    if (current === digest && hasSkillsPlugin) {
      return
    }
    const staging = `${skillsDir}.tmp-${process.pid}`
    await rm(staging, { recursive: true, force: true })
    await mkdir(join(staging, '.claude-plugin'), { recursive: true, mode: 0o700 })
    await writeFile(
      join(staging, '.claude-plugin', 'plugin.json'),
      JSON.stringify({
        name: SKILLS_PLUGIN,
        version: '1.0.0',
        description: 'Skills kept in Seal'
      })
    )
    for (const skill of skills) {
      if (skill.name.includes('/') || skill.name.includes('\\') || skill.name.startsWith('.')) {
        continue
      }
      const base = join(staging, 'skills', skill.name)
      for (const file of skillFiles(skill)) {
        const relative = safeRelative(file.path)
        const target = relative ? resolve(base, relative) : null
        if (!target || !target.startsWith(`${base}${sep}`)) {
          continue
        }
        await mkdir(dirname(target), { recursive: true, mode: 0o700 })
        await writeFile(target, Buffer.from(file.base64, 'base64'))
      }
    }
    await writeFile(join(staging, SKILLS_HASH_FILE), digest)
    await rm(skillsDir, { recursive: true, force: true })
    await rename(staging, skillsDir)
    hasSkillsPlugin = true
  }

  async function reconcileNow(config: SealConnectorsConfig): Promise<void> {
    const next = new Map<string, PluginState>()
    await mkdir(root, { recursive: true, mode: 0o700 })
    for (const harness of ['claude', 'codex'] as const) {
      const plugins = config.plugins.filter((plugin) => plugin.harness === harness)
      // A library home is created only when something needs it.
      if (plugins.length === 0 && !(await pathExists(homes[harness]))) {
        continue
      }
      try {
        await mkdir(homes[harness], { recursive: true, mode: 0o700 })
        await (harness === 'claude' ? reconcileClaude : reconcileCodex)(plugins, next)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        for (const plugin of plugins) {
          next.set(plugin.id, { installed: false, path: null, error: message })
        }
      }
    }
    states = next
    await writeSkillsPlugin(librarySkillsOf(config)).catch(() => {})
  }

  return {
    loaded,
    pluginDir: (pluginId) => states.get(pluginId)?.path ?? null,
    librarySkillsDir: () => (hasSkillsPlugin ? skillsDir : null),
    reconcile(config) {
      // One reconcile at a time: two CLIs writing one registry would corrupt it.
      const next = queue.then(() => reconcileNow(config)).catch(() => {})
      queue = next
      return next
    },
    markPending: (pluginId) => void pending.add(pluginId),
    clearPending: (pluginId) => void pending.delete(pluginId),
    state: () => [...states.entries()].map(([id, state]) => ({ id, ...state }))
  }
}
