import { AGENT_HOOK_TARGETS } from '../../agent-hook-listener/configuration/agent-hook-types'
import type { TuiAgent } from '../../agent-launch/catalog/tui-agent'

/** Agents whose status reaches the hook feed through a plugin, not a managed hook script. */
const PLUGIN_HOOK_AGENTS = ['opencode', 'opencode2', 'pi', 'omp'] as const

/** Agents that report nothing themselves: the window showing their pane lists them from its title. */
const PANE_TITLE_AGENTS = [
  'claude-agent-teams',
  'autohand',
  'mimo-code',
  'aider',
  'goose',
  'kilo',
  'crush',
  'aug',
  'cline',
  'codebuff',
  'freebuff',
  'continue',
  'mistral-vibe',
  'rovo',
  'openclaw',
  'ante',
  'trae',
  'prime-agent'
] as const

/** Every agent the launcher knows has a session adapter. */
export const AGENT_SESSION_AGENT_IDS = [
  ...AGENT_HOOK_TARGETS,
  ...PLUGIN_HOOK_AGENTS,
  ...PANE_TITLE_AGENTS
] as const satisfies readonly TuiAgent[]

type ListedAgent = (typeof AGENT_SESSION_AGENT_IDS)[number]

/** `never`, failing every use, once the launcher gains an agent the lists above lack. */
export type AgentSessionAgentId = [TuiAgent] extends [ListedAgent] ? ListedAgent : never

const AGENT_SESSION_AGENT_ID_SET: ReadonlySet<string> = new Set(AGENT_SESSION_AGENT_IDS)

export function isAgentSessionAgentId(value: unknown): value is AgentSessionAgentId {
  return typeof value === 'string' && AGENT_SESSION_AGENT_ID_SET.has(value)
}
