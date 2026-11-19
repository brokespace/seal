import { parseJsonObject } from '../../shared/agent-config/agent-config-json-edit'
import { newestPluginVersion } from '../../shared/agent-config/agent-config-plugin-skills'
import { parseTomlObject } from '../../shared/agent-config/agent-config-toml-edit'
import type { AgentConfigAgentId } from '../../shared/agent-config/agent-config-types'
import { isPlainObject } from '../../shared/agent-config/agent-config-values'
import { splitAgentPluginId } from '../../shared/agent-plugins/agent-plugin-catalog'
import {
  targetsInclude,
  targetsIncludeSystemAccount
} from '../../shared/agent-plugins/agent-plugin-targets'
import type {
  AgentPluginHarness,
  AgentPluginInstalledListing,
  AgentPluginListing,
  AgentPluginRecord,
  AgentPluginStep
} from '../../shared/agent-plugins/agent-plugin-types'
import { joinMachinePath } from '../../shared/machines/machine-paths'
import type { MachineConnection } from '../machines/connection/machine-connection'
import { detectAgentConfigAgents } from '../agent-config/agent-config-agent-detection'
import { joinRelative } from '../agent-config/agent-config-locations'
import {
  codexPluginArgs,
  pluginCommandArgs,
  runAgentCli,
  setPluginEnabled
} from '../agent-config/agent-config-plugin-commands'
import { patchSettings } from '../agent-config/agent-config-settings-ops'

const MAX_REGISTRY_BYTES = 8 * 1024 * 1024
export const HARNESS_LABELS: Record<AgentPluginHarness, string> = {
  claude: 'Claude Code',
  codex: 'Codex'
}

export type AgentPluginListingRef = Pick<AgentPluginListing, 'harness' | 'id'>

/** One machine's run: where things are, which agents are there, and what has happened so far. */
export type AgentPluginRun = {
  connection: MachineConnection
  home: string
  present: AgentConfigAgentId[]
  steps: AgentPluginStep[]
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function startAgentPluginRun(connection: MachineConnection): Promise<AgentPluginRun> {
  const [home, agents] = await Promise.all([
    connection.files.homeDir(),
    detectAgentConfigAgents(connection)
  ])
  return {
    connection,
    home,
    present: agents.filter((agent) => agent.installed || agent.configured).map((a) => a.agent),
    steps: []
  }
}

/** A failed step is recorded and the run goes on, so one agent cannot stop the others. */
export async function runStep(
  run: AgentPluginRun,
  label: string,
  work: () => Promise<unknown>
): Promise<void> {
  try {
    await work()
  } catch (error) {
    run.steps.push({ label, ok: false, output: errorText(error) })
  }
}

export async function readRegistry(
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

/** Claude Code's account-wide installs: id to folder, from the registry `claude plugin` keeps. */
export async function claudeUserInstalls(
  run: AgentPluginRun
): Promise<Map<string, { root: string; version: string | null }>> {
  const registry = await readRegistry(
    run.connection,
    joinRelative(run.home, '.claude/plugins/installed_plugins.json'),
    'json'
  )
  const plugins = isPlainObject(registry.plugins) ? registry.plugins : {}
  const installs = new Map<string, { root: string; version: string | null }>()
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

/** Claude Code's account-wide switches: `enabledPlugins` in its user settings. */
export async function claudeEnabledPlugins(run: AgentPluginRun): Promise<Record<string, unknown>> {
  const settings = await readRegistry(
    run.connection,
    joinRelative(run.home, '.claude/settings.json'),
    'json'
  )
  return isPlainObject(settings.enabledPlugins) ? settings.enabledPlugins : {}
}

/** Codex lists installed plugins as `[plugins."name@marketplace"]` in its config. */
export async function codexInstalls(run: AgentPluginRun): Promise<Map<string, boolean>> {
  const config = await readRegistry(
    run.connection,
    joinRelative(run.home, '.codex/config.toml'),
    'toml'
  )
  const plugins = isPlainObject(config.plugins) ? config.plugins : {}
  return new Map(
    Object.entries(plugins).map(([id, value]) => [
      id,
      !isPlainObject(value) || value.enabled !== false
    ])
  )
}

/** Codex unpacks each version under `plugins/cache/<marketplace>/<name>/<version>`. */
async function codexRoot(
  run: AgentPluginRun,
  id: string
): Promise<{ root: string; version: string | null } | null> {
  const { name, marketplace } = splitAgentPluginId(id)
  const base = joinRelative(run.home, `.codex/plugins/cache/${marketplace}/${name}`)
  const entries = await run.connection.files.listDir(base).catch(() => [])
  const version = newestPluginVersion(
    entries.filter((entry) => entry.isDirectoryLike).map((entry) => entry.name)
  )
  return version ? { root: joinMachinePath(base, version), version } : null
}

export async function installedRoot(
  run: AgentPluginRun,
  listing: AgentPluginListingRef
): Promise<{ root: string; version: string | null } | null> {
  if (listing.harness === 'claude') {
    return (await claudeUserInstalls(run)).get(listing.id) ?? null
  }
  return (await codexInstalls(run)).has(listing.id) ? codexRoot(run, listing.id) : null
}

async function runNative(
  run: AgentPluginRun,
  listing: AgentPluginListingRef,
  kind: 'install' | 'uninstall'
): Promise<boolean> {
  const result =
    listing.harness === 'claude'
      ? await runAgentCli(
          run.connection,
          'claude',
          pluginCommandArgs({ kind, plugin: listing.id, scope: 'user' })
        )
      : await runAgentCli(run.connection, 'codex', codexPluginArgs(kind, listing.id))
  run.steps.push({
    label: `${HARNESS_LABELS[listing.harness]}: ${kind} ${listing.id}`,
    ok: result.ok,
    command: result.command,
    output: result.output
  })
  return result.ok
}

/** The agent's own installer; a plugin already there is taken over as it is switched now. */
export async function installNative(
  run: AgentPluginRun,
  listing: AgentPluginListingRef
): Promise<AgentPluginInstalledListing | null> {
  const ref = { harness: listing.harness, id: listing.id }
  if (await installedRoot(run, ref)) {
    run.steps.push({ label: `${HARNESS_LABELS[ref.harness]}: already installed`, ok: true })
    const enabledBefore =
      ref.harness === 'claude'
        ? (await claudeEnabledPlugins(run))[ref.id] === true
        : (await codexInstalls(run)).get(ref.id) !== false
    return { ...ref, preexisting: true, enabledBefore }
  }
  return (await runNative(run, ref, 'install')) ? ref : null
}

export async function uninstallNative(
  run: AgentPluginRun,
  listing: AgentPluginListingRef
): Promise<void> {
  await runNative(run, listing, 'uninstall')
}

/** A native install is switched on where its agent and the machine's own login are targeted. */
export async function setNativeEnabled(
  run: AgentPluginRun,
  record: AgentPluginRecord,
  listing: AgentPluginListingRef
): Promise<void> {
  await switchNative(
    run,
    listing,
    record.enabled &&
      targetsInclude(record.targets.agents, listing.harness) &&
      targetsIncludeSystemAccount(record.targets, listing.harness)
  )
}

export async function switchNative(
  run: AgentPluginRun,
  listing: AgentPluginListingRef,
  enabled: boolean
): Promise<void> {
  const target = { machineId: run.connection.machineId, agent: listing.harness }
  await runStep(run, `${HARNESS_LABELS[listing.harness]}: switch ${listing.id}`, () =>
    listing.harness === 'claude'
      ? setPluginEnabled(run.connection, { target, scope: 'user', plugin: listing.id, enabled })
      : patchSettings(run.connection, {
          target,
          scope: 'user',
          edits: [{ path: ['plugins', listing.id, 'enabled'], value: enabled }]
        })
  )
}
