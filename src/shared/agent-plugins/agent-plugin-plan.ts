import { AGENT_CONFIG_LAYOUTS } from '../agent-config/agent-config-catalog'
import type { AgentConfigLayout } from '../agent-config/agent-config-layout-types'
import type { AgentConfigAgentId } from '../agent-config/agent-config-types'
import { isPlainObject } from '../agent-config/agent-config-values'
import {
  AGENT_PLUGIN_COMPONENT_KINDS,
  type AgentPluginComponentKind,
  type AgentPluginComponents,
  type AgentPluginHarness,
  type AgentPluginMode,
  type AgentPluginTargetList
} from './agent-plugin-types'
import { targetsInclude } from './agent-plugin-targets'

/** What one agent will get from a plugin, decided before anything is written. */
export type AgentPluginAgentPlan = {
  agent: AgentConfigAgentId
  label: string
  mode: AgentPluginMode
  /** The plugin's MCP servers go into this agent's own MCP file. */
  mcpServers: boolean
  /** Skills folder under the home folder that takes links to the plugin's skills. */
  skillsDir: string | null
  /** Another agent's link this agent already reads. */
  skillsVia: AgentConfigAgentId | null
  notApplicable: AgentPluginComponentKind[]
}

/** Seal moves only MCP servers and skills between agents; the rest is each agent's own format. */
const TRANSLATED_KINDS: ReadonlySet<AgentPluginComponentKind> = new Set(['mcpServers', 'skills'])

function skillDirs(layout: AgentConfigLayout): { dir: string; shared: boolean }[] {
  return layout.user.collections
    .filter((collection) => collection.kind === 'skill')
    .map((collection) => ({ dir: collection.dir, shared: collection.shared === true }))
}

function isHarness(agent: AgentConfigAgentId, harnesses: readonly AgentPluginHarness[]): boolean {
  return harnesses.some((harness) => harness === agent)
}

/**
 * Per agent, in catalog order: its own installer when its marketplace has the plugin, else MCP
 * servers into its MCP file and one skills link it reads, never two, and never one a native
 * install would read twice.
 */
export function planAgentPlugin(args: {
  native: readonly AgentPluginHarness[]
  components: AgentPluginComponents
  presentAgents: readonly AgentConfigAgentId[]
  agents: AgentPluginTargetList<AgentConfigAgentId>
}): AgentPluginAgentPlan[] {
  const has = (kind: AgentPluginComponentKind): boolean => args.components[kind].length > 0
  const readers = (dir: string): AgentConfigAgentId[] =>
    AGENT_CONFIG_LAYOUTS.filter((layout) =>
      skillDirs(layout).some((candidate) => candidate.dir === dir)
    ).map((layout) => layout.id)
  const linkedBy = new Map<string, AgentConfigAgentId>()
  return AGENT_CONFIG_LAYOUTS.map((layout): AgentPluginAgentPlan => {
    const base = {
      agent: layout.id,
      label: layout.label,
      mcpServers: false,
      skillsDir: null,
      skillsVia: null,
      notApplicable: []
    }
    if (!targetsInclude(args.agents, layout.id)) {
      return { ...base, mode: 'excluded' }
    }
    if (isHarness(layout.id, args.native)) {
      return { ...base, mode: 'native' }
    }
    if (!args.presentAgents.includes(layout.id)) {
      return { ...base, mode: 'absent' }
    }
    const notApplicable = AGENT_PLUGIN_COMPONENT_KINDS.filter(
      (kind) => has(kind) && !TRANSLATED_KINDS.has(kind)
    )
    if (has('mcpServers') && !layout.user.mcp) {
      notApplicable.unshift('mcpServers')
    }
    let skillsDir: string | null = null
    let skillsVia: AgentConfigAgentId | null = null
    if (has('skills')) {
      const dirs = skillDirs(layout)
      const covered = dirs.find((candidate) => linkedBy.has(candidate.dir))
      const own = dirs
        .toSorted((a, b) => Number(a.shared) - Number(b.shared))
        .find((candidate) => !readers(candidate.dir).some((agent) => isHarness(agent, args.native)))
      if (covered) {
        skillsVia = linkedBy.get(covered.dir) ?? null
      } else if (own) {
        skillsDir = own.dir
        linkedBy.set(own.dir, layout.id)
      } else {
        notApplicable.push('skills')
      }
    }
    return {
      ...base,
      mode: 'translated',
      mcpServers: has('mcpServers') && Boolean(layout.user.mcp),
      skillsDir,
      skillsVia,
      notApplicable
    }
  })
}

const ROOT_VARIABLES = ['${CLAUDE_PLUGIN_ROOT}', '${PLUGIN_ROOT}']

/** Agents other than the plugin's own do not expand its root variable, so it is written out. */
export function withPluginRoot(value: unknown, root: string): unknown {
  if (typeof value === 'string') {
    return ROOT_VARIABLES.reduce((text, variable) => text.replaceAll(variable, root), value)
  }
  if (Array.isArray(value)) {
    return value.map((item) => withPluginRoot(item, root))
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, withPluginRoot(item, root)])
    )
  }
  return value
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
