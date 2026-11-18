import { AGENT_LIST_STATUS_RANK } from '../../../src/shared/agent-status/presentation/agent-list-status'
import type { AgentDotState } from '../worktree/agent-row-display'

export type AgentStatusGroup = 'needs-you' | 'working' | 'done' | 'idle'

/** Desktop's status ranks cut into sections: everything ranked above live work needs the user. */
export function agentStatusGroup(state: AgentDotState): AgentStatusGroup {
  const rank = AGENT_LIST_STATUS_RANK[state]
  if (rank < AGENT_LIST_STATUS_RANK.working) {
    return 'needs-you'
  }
  if (rank <= AGENT_LIST_STATUS_RANK.monitoring) {
    return 'working'
  }
  return state === 'idle' ? 'idle' : 'done'
}
