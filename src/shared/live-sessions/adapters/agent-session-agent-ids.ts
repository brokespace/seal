import { AGENT_HOOK_TARGETS } from '../../agent-hook-listener/configuration/agent-hook-types'
import type { TuiAgent } from '../../agent-launch/catalog/tui-agent'

/** Agents whose status reaches the hook feed through a plugin, not a managed hook script. */
const PLUGIN_HOOK_AGENTS = ['opencode', 'opencode2', 'pi', 'omp'] as const

/** Every agent with a session adapter: each managed hook target and each plugin agent. */
export const AGENT_SESSION_AGENT_IDS = [
  ...AGENT_HOOK_TARGETS,
  ...PLUGIN_HOOK_AGENTS
] as const satisfies readonly TuiAgent[]

export type AgentSessionAgentId = (typeof AGENT_SESSION_AGENT_IDS)[number]

const AGENT_SESSION_AGENT_ID_SET: ReadonlySet<string> = new Set(AGENT_SESSION_AGENT_IDS)

export function isAgentSessionAgentId(value: unknown): value is AgentSessionAgentId {
  return typeof value === 'string' && AGENT_SESSION_AGENT_ID_SET.has(value)
}
