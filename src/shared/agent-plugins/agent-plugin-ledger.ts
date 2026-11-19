import { isAgentConfigAgentId } from '../agent-config/agent-config-catalog'
import type { AgentConfigAgentId } from '../agent-config/agent-config-types'
import { isPlainObject, stringList } from '../agent-config/agent-config-values'
import { parseAgentPluginTargets } from './agent-plugin-targets'
import {
  AGENT_PLUGIN_COMPONENT_KINDS,
  AGENT_PLUGIN_HARNESSES,
  type AgentPluginAgentState,
  type AgentPluginComponentKind,
  type AgentPluginInstalledListing,
  type AgentPluginLedger,
  type AgentPluginMode,
  type AgentPluginProvides,
  type AgentPluginRecord,
  type AgentPluginView
} from './agent-plugin-types'

/** Under the home folder of each machine, beside Seal's config backups. */
export const AGENT_PLUGIN_LEDGER_PATH = '.seal/agent-plugins.json'

const MODES: readonly AgentPluginMode[] = ['native', 'translated', 'absent', 'excluded']

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function pathEntries(value: unknown): { name: string; path: string }[] {
  return (Array.isArray(value) ? value : []).filter(isPlainObject).flatMap((entry) => {
    const name = text(entry.name)
    const path = text(entry.path)
    return name && path ? [{ name, path }] : []
  })
}

function kindsOf(value: unknown): AgentPluginComponentKind[] {
  return AGENT_PLUGIN_COMPONENT_KINDS.filter((kind) => stringList(value).includes(kind))
}

function agentStateOf(value: unknown): AgentPluginAgentState[] {
  return (Array.isArray(value) ? value : []).filter(isPlainObject).flatMap((entry) => {
    const agent = entry.agent
    const mode = MODES.find((candidate) => candidate === entry.mode)
    if (!isAgentConfigAgentId(agent) || !mode) {
      return []
    }
    const skills = (Array.isArray(entry.skills) ? entry.skills : [])
      .filter(isPlainObject)
      .flatMap((skill) => {
        const name = text(skill.name)
        const via = skill.via
        return name
          ? [
              {
                name,
                path: text(skill.path),
                ...(isAgentConfigAgentId(via) ? { via } : {})
              }
            ]
          : []
      })
    return [
      {
        agent,
        mode,
        mcpServers: pathEntries(entry.mcpServers),
        skills,
        notApplicable: kindsOf(entry.notApplicable),
        skipped: stringList(entry.skipped),
        ...(text(entry.error) ? { error: text(entry.error) } : {})
      }
    ]
  })
}

function mcpEntriesOf(value: unknown): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(isPlainObject(value) ? value : {}).filter(
      (entry): entry is [string, Record<string, unknown>] => isPlainObject(entry[1])
    )
  )
}

function providesOf(value: unknown): AgentPluginProvides {
  const record = isPlainObject(value) ? value : {}
  return {
    mcpServers: mcpEntriesOf(record.mcpServers),
    skills: (Array.isArray(record.skills) ? record.skills : [])
      .filter(isPlainObject)
      .flatMap((skill) =>
        text(skill.name) && text(skill.directory)
          ? [{ name: text(skill.name), directory: text(skill.directory) }]
          : []
      ),
    commands: stringList(record.commands),
    agents: stringList(record.agents),
    hooks: stringList(record.hooks),
    lspServers: stringList(record.lspServers),
    apps: stringList(record.apps)
  }
}

function listingsOf(value: unknown): AgentPluginInstalledListing[] {
  return (Array.isArray(value) ? value : []).filter(isPlainObject).flatMap((listing) => {
    const harness = AGENT_PLUGIN_HARNESSES.find((candidate) => candidate === listing.harness)
    if (!harness || !text(listing.id)) {
      return []
    }
    return [
      {
        harness,
        id: text(listing.id),
        ...(listing.preexisting === true
          ? { preexisting: true as const, enabledBefore: listing.enabledBefore !== false }
          : {})
      }
    ]
  })
}

/** Reads the ledger leniently: a record Seal cannot make sense of is dropped, not fatal. */
export function parseAgentPluginLedger(value: unknown): AgentPluginLedger {
  const plugins = isPlainObject(value) && Array.isArray(value.plugins) ? value.plugins : []
  return {
    version: 1,
    plugins: plugins.filter(isPlainObject).flatMap((plugin): AgentPluginRecord[] => {
      const name = text(plugin.name)
      if (!name) {
        return []
      }
      return [
        {
          name,
          description: text(plugin.description),
          version: text(plugin.version) || null,
          listings: listingsOf(plugin.listings),
          root: text(plugin.root),
          enabled: plugin.enabled !== false,
          installedAt: text(plugin.installedAt),
          targets: parseAgentPluginTargets(plugin.targets),
          provides: providesOf(plugin.provides),
          agents: agentStateOf(plugin.agents)
        }
      ]
    }),
    retiredMcpServers: mcpEntriesOf(isPlainObject(value) ? value.retiredMcpServers : undefined)
  }
}

export function agentPluginView(record: AgentPluginRecord): AgentPluginView {
  const { provides, ...rest } = record
  return {
    ...rest,
    components: {
      mcpServers: Object.keys(provides.mcpServers),
      skills: provides.skills.map((skill) => skill.name),
      commands: provides.commands,
      agents: provides.agents,
      hooks: provides.hooks,
      lspServers: provides.lspServers,
      apps: provides.apps
    }
  }
}

function samePath(a: string, b: string): boolean {
  const normalize = (path: string): string => path.replaceAll('\\', '/').replace(/\/+$/, '')
  return normalize(a) === normalize(b)
}

export type AgentPluginOrigin = { name: string; enabled: boolean }

/** The plugin that wrote this server into this agent's file, if Seal put it there. */
export function pluginForMcpServer(
  ledger: AgentPluginLedger,
  agent: AgentConfigAgentId,
  path: string,
  name: string
): AgentPluginOrigin | null {
  const plugin = ledger.plugins.find((record) =>
    record.agents.some(
      (state) =>
        state.agent === agent &&
        state.mcpServers.some((server) => server.name === name && samePath(server.path, path))
    )
  )
  return plugin ? { name: plugin.name, enabled: plugin.enabled } : null
}

/** The plugin whose skill Seal linked into this folder. */
export function pluginForSkillDirectory(
  ledger: AgentPluginLedger,
  directory: string
): AgentPluginOrigin | null {
  const plugin = ledger.plugins.find((record) =>
    record.agents.some((state) =>
      state.skills.some((skill) => !skill.via && samePath(skill.path, directory))
    )
  )
  return plugin ? { name: plugin.name, enabled: plugin.enabled } : null
}
