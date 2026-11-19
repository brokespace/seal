import { listMcpServers } from '../../shared/agent-config/agent-config-mcp-servers'
import type {
  AgentConfigAgentId,
  AgentConfigDocRef,
  AgentConfigMcpServer
} from '../../shared/agent-config/agent-config-types'
import {
  pluginForMcpServer,
  pluginForSkillDirectory
} from '../../shared/agent-plugins/agent-plugin-ledger'
import { withPluginRoot } from '../../shared/agent-plugins/agent-plugin-plan'
import type { AgentPluginLedger } from '../../shared/agent-plugins/agent-plugin-types'
import { joinRelative } from './agent-config-locations'

/** Servers that ship inside a plugin this agent installed natively; they are not in its files. */
function nativePluginServers(
  ledger: AgentPluginLedger,
  agent: AgentConfigAgentId
): AgentConfigMcpServer[] {
  return ledger.plugins
    .filter((plugin) => plugin.enabled && plugin.listings.some((l) => l.harness === agent))
    .flatMap((plugin) =>
      listMcpServers(
        { mcpServers: withPluginRoot(plugin.provides.mcpServers, plugin.root) },
        {
          scope: 'user',
          sourcePath: joinRelative(plugin.root, '.mcp.json'),
          codec: 'claude',
          serversPath: ['mcpServers']
        }
      ).map((server) => ({ ...server, plugin: { name: plugin.name, enabled: true, native: true } }))
    )
}

/** Marks servers Seal copied from a plugin and adds the ones a native install brings. */
export function withAgentPluginServers(
  servers: AgentConfigMcpServer[],
  ledger: AgentPluginLedger,
  agent: AgentConfigAgentId,
  inProject: boolean
): AgentConfigMcpServer[] {
  return [
    ...servers.map((server) => {
      const origin = pluginForMcpServer(ledger, agent, server.sourcePath, server.name)
      return origin ? { ...server, plugin: { ...origin, native: false } } : server
    }),
    ...(inProject ? [] : nativePluginServers(ledger, agent))
  ]
}

/** A skill folder Seal linked from a plugin is that plugin's, not one the user wrote. */
export function withAgentPluginOrigin(
  doc: AgentConfigDocRef,
  ledger: AgentPluginLedger
): AgentConfigDocRef {
  const origin =
    doc.kind === 'skill' && doc.directory ? pluginForSkillDirectory(ledger, doc.directory) : null
  const record = origin ? ledger.plugins.find((plugin) => plugin.name === origin.name) : undefined
  return origin
    ? {
        ...doc,
        bundle: {
          kind: 'plugin',
          id: origin.name,
          name: origin.name,
          version: record?.version ?? null,
          enabled: origin.enabled
        }
      }
    : doc
}
