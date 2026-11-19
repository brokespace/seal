import { AGENT_CONFIG_IPC } from '../../shared/agent-config/agent-config-types'
import type { MachineConnection } from '../machines/connection/machine-connection'
import { requireString, type MachineInvokeRegistrar } from '../machines/machine-ipc-args'
import { agentPluginRequestOf } from '../agent-config/agent-config-ipc-args'
import { installAgentPlugin, removeAgentPlugin, setAgentPluginEnabled } from './agent-plugin-apply'
import { readAgentPluginCatalog } from './agent-plugin-catalog-read'
import { readAgentPluginInventory } from './agent-plugin-inventory'

/** One machine per call; the page fans out over machines so each reports on its own. */
export function registerAgentPluginHandlers(
  handle: MachineInvokeRegistrar,
  connected: (machineId: unknown) => Promise<MachineConnection>
): void {
  handle(AGENT_CONFIG_IPC.agentPluginCatalog, async (args) =>
    readAgentPluginCatalog(await connected(args.machineId))
  )
  handle(AGENT_CONFIG_IPC.agentPluginInventory, async (args) =>
    readAgentPluginInventory(await connected(args.machineId))
  )
  handle(AGENT_CONFIG_IPC.installAgentPlugin, async (args) =>
    installAgentPlugin(await connected(args.machineId), agentPluginRequestOf(args.request))
  )
  handle(AGENT_CONFIG_IPC.setAgentPluginEnabled, async (args) =>
    setAgentPluginEnabled(
      await connected(args.machineId),
      requireString(args.name, 'name'),
      args.enabled === true
    )
  )
  handle(AGENT_CONFIG_IPC.removeAgentPlugin, async (args) =>
    removeAgentPlugin(await connected(args.machineId), requireString(args.name, 'name'))
  )
}
