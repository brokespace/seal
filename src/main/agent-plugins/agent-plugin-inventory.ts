import { splitAgentPluginId } from '../../shared/agent-plugins/agent-plugin-catalog'
import { agentPluginView } from '../../shared/agent-plugins/agent-plugin-ledger'
import type {
  AgentPluginInventory,
  AgentPluginUnshared
} from '../../shared/agent-plugins/agent-plugin-types'
import type { MachineConnection } from '../machines/connection/machine-connection'
import { readAgentPluginLedger } from './agent-plugin-ledger-io'
import {
  claudeEnabledPlugins,
  claudeUserInstalls,
  codexInstalls,
  startAgentPluginRun
} from './agent-plugin-native'

/** The ledger as the page shows it, plus native installs Seal has not shared yet. */
export async function readAgentPluginInventory(
  connection: MachineConnection
): Promise<AgentPluginInventory> {
  const run = await startAgentPluginRun(connection)
  const [ledger, claude, codex, claudeEnabled] = await Promise.all([
    readAgentPluginLedger(connection, run.home),
    claudeUserInstalls(run),
    codexInstalls(run),
    claudeEnabledPlugins(run)
  ])
  const shared = new Set(
    ledger.plugins.flatMap((plugin) => plugin.listings.map((listing) => listing.id))
  )
  const unshared: AgentPluginUnshared[] = [
    ...[...claude.keys()].map((id) => ({
      harness: 'claude' as const,
      id,
      name: splitAgentPluginId(id).name,
      enabled: claudeEnabled[id] === true
    })),
    ...[...codex.entries()].map(([id, enabled]) => ({
      harness: 'codex' as const,
      id,
      name: splitAgentPluginId(id).name,
      enabled
    }))
  ].filter((plugin) => !shared.has(plugin.id))
  return {
    machineId: connection.machineId,
    plugins: ledger.plugins.map(agentPluginView),
    unshared,
    presentAgents: run.present
  }
}
