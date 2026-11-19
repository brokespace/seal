import type { AgentConfigAgentId } from '../agent-config/agent-config-types'
import type { MachineId } from '../machines/machine-types'

/** Agents with a plugin marketplace and an installer of their own. */
export type AgentPluginHarness = 'claude' | 'codex'

export const AGENT_PLUGIN_HARNESSES: readonly AgentPluginHarness[] = ['claude', 'codex']

export type AgentPluginComponentKind =
  | 'mcpServers'
  | 'skills'
  | 'commands'
  | 'agents'
  | 'hooks'
  | 'lspServers'
  | 'apps'

export const AGENT_PLUGIN_COMPONENT_KINDS: readonly AgentPluginComponentKind[] = [
  'mcpServers',
  'skills',
  'commands',
  'agents',
  'hooks',
  'lspServers',
  'apps'
]

/** Names of what a plugin brings, by kind. */
export type AgentPluginComponents = Record<AgentPluginComponentKind, string[]>

/** One marketplace's entry for a plugin, as that harness's own CLI lists it. */
export type AgentPluginListing = {
  harness: AgentPluginHarness
  /** `name@marketplace`. */
  id: string
  marketplace: string
  version: string | null
  installed: boolean
  enabled: boolean
  installCount?: number
  /** Codex's `installPolicy`, e.g. `AVAILABLE`. */
  installPolicy?: string
  /** Codex's `authPolicy`, e.g. `ON_INSTALL`. */
  authPolicy?: string
}

/** A plugin by name, with every harness marketplace that offers it. */
export type AgentPluginCatalogEntry = {
  name: string
  description: string
  listings: AgentPluginListing[]
  /** From Claude Code's catalog cache; null until the plugin's folder has been read. */
  components: AgentPluginComponents | null
}

export type AgentPluginCatalog = {
  entries: AgentPluginCatalogEntry[]
  harnesses: { harness: AgentPluginHarness; available: boolean; error?: string }[]
}

/** `all` keeps reaching machines, accounts and agents that appear later. */
export type AgentPluginTargetList<T extends string> = 'all' | T[]

/**
 * Where a plugin applies. Accounts are Seal account keys (`claude:<email>`); each agent's own
 * login on a machine is `<provider>:system`.
 */
export type AgentPluginTargets = {
  machines: AgentPluginTargetList<MachineId>
  accounts: AgentPluginTargetList<string>
  agents: AgentPluginTargetList<AgentConfigAgentId>
}

export const AGENT_PLUGIN_ALL_TARGETS: AgentPluginTargets = {
  machines: 'all',
  accounts: 'all',
  agents: 'all'
}

export function agentPluginSystemAccount(provider: AgentPluginHarness): string {
  return `${provider}:system`
}

/** What a plugin's folder provides; MCP entries are kept as the plugin wrote them. */
export type AgentPluginProvides = {
  mcpServers: Record<string, Record<string, unknown>>
  skills: { name: string; directory: string }[]
  commands: string[]
  agents: string[]
  hooks: string[]
  lspServers: string[]
  apps: string[]
}

export function emptyAgentPluginComponents(): AgentPluginComponents {
  return {
    mcpServers: [],
    skills: [],
    commands: [],
    agents: [],
    hooks: [],
    lspServers: [],
    apps: []
  }
}
