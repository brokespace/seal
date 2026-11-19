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

/**
 * How one agent takes a plugin: its own installer, Seal's translation, not on the machine, or
 * left out by the plugin's targets.
 */
export type AgentPluginMode = 'native' | 'translated' | 'absent' | 'excluded'

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

export type AgentPluginWrittenServer = { name: string; path: string }

export type AgentPluginLinkedSkill = {
  name: string
  /** The link in the agent's skills folder. */
  path: string
  /** Another agent whose skills folder this one reads, so no link of its own was made. */
  via?: AgentConfigAgentId
}

/** What one agent on one machine got from a plugin. */
export type AgentPluginAgentState = {
  agent: AgentConfigAgentId
  mode: AgentPluginMode
  mcpServers: AgentPluginWrittenServer[]
  skills: AgentPluginLinkedSkill[]
  /** Kinds the plugin brings that this agent has no place for. */
  notApplicable: AgentPluginComponentKind[]
  /** Items that were skipped, each with why. */
  skipped: string[]
  error?: string
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

/** One plugin in Seal's ledger on a machine: the single record every page reads. */
export type AgentPluginRecord = {
  name: string
  description: string
  version: string | null
  /** The listings installed natively; the first one's folder is what others are translated from. */
  listings: Pick<AgentPluginListing, 'harness' | 'id'>[]
  root: string
  enabled: boolean
  installedAt: string
  targets: AgentPluginTargets
  provides: AgentPluginProvides
  agents: AgentPluginAgentState[]
}

export type AgentPluginLedger = { version: 1; plugins: AgentPluginRecord[] }

/** A ledger record as the page sees it: MCP entries reduced to names so no secret leaves main. */
export type AgentPluginView = Omit<AgentPluginRecord, 'provides'> & {
  components: AgentPluginComponents
}

/** A native install Seal has not shared with the other agents yet. */
export type AgentPluginUnshared = {
  harness: AgentPluginHarness
  id: string
  name: string
  enabled: boolean
}

export type AgentPluginInventory = {
  machineId: MachineId
  plugins: AgentPluginView[]
  unshared: AgentPluginUnshared[]
  /** Agents on the machine: their CLI is on PATH or their config folder exists. */
  presentAgents: AgentConfigAgentId[]
}

/** What to install: the plugin's name and each harness listing to install natively. */
export type AgentPluginInstallRequest = {
  name: string
  listings: Pick<AgentPluginListing, 'harness' | 'id'>[]
  targets: AgentPluginTargets
}

export type AgentPluginStep = {
  label: string
  ok: boolean
  /** The command that ran, for repeating it by hand. */
  command?: string
  output?: string
}

export type AgentPluginMachineResult = {
  machineId: MachineId
  ok: boolean
  steps: AgentPluginStep[]
  record: AgentPluginView | null
  error?: string
}

export type AgentPluginAction = 'install' | 'enable' | 'disable' | 'remove'
