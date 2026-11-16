// The adapter table with its main-process parts attached: the one catalog Seal's session code asks about an agent.
import type { AgentSessionAdapter } from '../../../shared/live-sessions/adapters/agent-session-adapter'
import { AGENT_SESSION_ADAPTERS } from '../../../shared/live-sessions/adapters/agent-session-adapters'
import {
  isAgentSessionAgentId,
  type AgentSessionAgentId
} from '../../../shared/live-sessions/adapters/agent-session-agent-ids'
import { CLAUDE_SESSION_DISCOVERY } from './claude-session-adapter'
import { CODEX_SESSION_DISCOVERY } from './codex-session-adapter'

/** Agents found outside Seal. Any other agent is listed from its chat or its Seal pane only. */
const DISCOVERY: Partial<
  Record<AgentSessionAgentId, NonNullable<AgentSessionAdapter['discovery']>>
> = {
  claude: CLAUDE_SESSION_DISCOVERY,
  codex: CODEX_SESSION_DISCOVERY
}

const ADAPTERS = new Map<AgentSessionAgentId, AgentSessionAdapter>(
  Object.values(AGENT_SESSION_ADAPTERS).map((adapter) => {
    const discovery = DISCOVERY[adapter.agent]
    return [adapter.agent, discovery ? { ...adapter, discovery } : adapter]
  })
)

/** The adapter of `agent`, or null when Seal's session code does not know the agent. */
export function liveSessionAdapter(agent: string | null | undefined): AgentSessionAdapter | null {
  return isAgentSessionAgentId(agent) ? (ADAPTERS.get(agent) ?? null) : null
}
