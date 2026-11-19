import { agentPluginView } from '../../shared/agent-plugins/agent-plugin-ledger'
import { targetsInclude } from '../../shared/agent-plugins/agent-plugin-targets'
import type {
  AgentPluginInstallRequest,
  AgentPluginMachineResult,
  AgentPluginRecord
} from '../../shared/agent-plugins/agent-plugin-types'
import type { MachineConnection } from '../machines/connection/machine-connection'
import { readAgentPluginFolder } from './agent-plugin-folder-read'
import { readAgentPluginLedger, updateAgentPluginLedger } from './agent-plugin-ledger-io'
import {
  installedRoot,
  installNative,
  startAgentPluginRun,
  uninstallNative,
  type AgentPluginListingRef,
  type AgentPluginRun
} from './agent-plugin-native'
import { applyRecord, undoTranslations } from './agent-plugin-translation'

function resultOf(
  run: AgentPluginRun,
  record: AgentPluginRecord | null,
  error?: string
): AgentPluginMachineResult {
  const failed =
    error !== undefined ||
    run.steps.some((item) => !item.ok) ||
    Boolean(record?.agents.some((state) => state.error))
  return {
    machineId: run.connection.machineId,
    ok: !failed,
    steps: run.steps,
    record: record ? agentPluginView(record) : null,
    ...(error ? { error } : {})
  }
}

/**
 * Installs natively in every targeted agent whose marketplace has the plugin, then gives the
 * other agents its MCP servers and skills. Running it again with other targets re-applies.
 */
export async function installAgentPlugin(
  connection: MachineConnection,
  request: AgentPluginInstallRequest
): Promise<AgentPluginMachineResult> {
  const run = await startAgentPluginRun(connection)
  const previous = (await readAgentPluginLedger(connection, run.home)).plugins.find(
    (plugin) => plugin.name === request.name
  )
  const native: AgentPluginListingRef[] = []
  for (const listing of request.listings) {
    if (
      targetsInclude(request.targets.agents, listing.harness) &&
      (await installNative(run, listing))
    ) {
      native.push(listing)
    }
  }
  // An agent taken out of the targets keeps its install, switched off.
  const listings = [
    ...native,
    ...(previous?.listings ?? []).filter(
      (old) => !native.some((listing) => listing.harness === old.harness)
    )
  ]
  let found: { root: string; version: string | null } | null = null
  for (const listing of listings) {
    found ??= await installedRoot(run, listing)
  }
  if (!found) {
    return resultOf(
      run,
      null,
      'No agent on this machine could install it from its own marketplace, so there is nothing to share with the others.'
    )
  }
  const { root, version } = found
  const folder = await readAgentPluginFolder(connection, root)
  const record = await updateAgentPluginLedger(connection, run.home, async (ledger) => {
    const old = ledger.plugins.find((plugin) => plugin.name === request.name)
    if (old) {
      await undoTranslations(run, old)
    }
    const next: AgentPluginRecord = {
      name: request.name,
      description: folder.description || old?.description || '',
      version: folder.version ?? version,
      listings,
      root,
      enabled: old?.enabled ?? true,
      installedAt: old?.installedAt || new Date().toISOString(),
      targets: request.targets,
      provides: folder.provides,
      agents: []
    }
    next.agents = await applyRecord(run, next)
    return {
      ledger: {
        ...ledger,
        plugins: [...ledger.plugins.filter((plugin) => plugin.name !== request.name), next]
      },
      result: next
    }
  })
  return resultOf(run, record)
}

/** Off takes Seal's copies out and switches native installs off; on puts them back. */
export async function setAgentPluginEnabled(
  connection: MachineConnection,
  name: string,
  enabled: boolean
): Promise<AgentPluginMachineResult> {
  const run = await startAgentPluginRun(connection)
  const record = await updateAgentPluginLedger(connection, run.home, async (ledger) => {
    const old = ledger.plugins.find((plugin) => plugin.name === name)
    if (!old) {
      throw new Error(`${name} is not installed through Seal on this machine`)
    }
    await undoTranslations(run, old)
    const next = { ...old, enabled }
    next.agents = await applyRecord(run, next)
    return {
      ledger: { ...ledger, plugins: ledger.plugins.map((p) => (p.name === name ? next : p)) },
      result: next
    }
  })
  return resultOf(run, record)
}

/** Takes the plugin out of every agent: Seal's copies first, then each native install. */
export async function removeAgentPlugin(
  connection: MachineConnection,
  name: string
): Promise<AgentPluginMachineResult> {
  const run = await startAgentPluginRun(connection)
  await updateAgentPluginLedger(connection, run.home, async (ledger) => {
    const old = ledger.plugins.find((plugin) => plugin.name === name)
    if (old) {
      await undoTranslations(run, old)
      for (const listing of old.listings) {
        await uninstallNative(run, listing)
      }
    }
    return {
      ledger: { ...ledger, plugins: ledger.plugins.filter((plugin) => plugin.name !== name) },
      result: undefined
    }
  })
  return resultOf(run, null)
}
