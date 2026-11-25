// What a pane's hook row says of its agent, as evidence for the status module.
import type { PendingPrompt } from '../agent-status/contracts/agent-pending-prompt'
import type { AgentStatusIpcPayload } from '../agent-status/contracts/agent-status-ipc-payload'
import { isAgentStatusHeldOpenByChildWork } from '../agent-status/lifecycle/agent-lead-status-fold'
import { agentVerdictDisplayMark } from '../agent-status/lifecycle/agent-main-agent-verdict'
import { isAskUserQuestionTool } from '../agent-status/lifecycle/agent-question-answered-intent'
import type {
  AgentSessionAdapter,
  AgentSessionStatusEvidence
} from './adapters/agent-session-adapter'
import { isClaudeAskTool } from './claude-ask-tools'

/** A hook reports a question and a permission request alike as `waiting`. */
function waitsOnQuestion(
  row: Pick<AgentStatusIpcPayload, 'toolName'>,
  prompt: PendingPrompt | null
): boolean {
  if (prompt?.kind === 'approval') {
    return false
  }
  // Any other tool the agent stopped on waits for its permission prompt.
  return (
    prompt?.kind === 'question' ||
    !row.toolName ||
    isAskUserQuestionTool(row.toolName) ||
    isClaudeAskTool(row.toolName)
  )
}

export function hookRowEvidence(
  row: AgentStatusIpcPayload,
  prompt: PendingPrompt | null,
  adapter: AgentSessionAdapter | null
): AgentSessionStatusEvidence {
  const question = row.state === 'waiting' && waitsOnQuestion(row, prompt)
  const turnFailed = agentVerdictDisplayMark(row) === 'failed'
  const working = row.state === 'working'
  // The turn ended and the host still counts work under it: shells and monitors, or agents.
  const leftBehind = working && row.workingMode === 'monitoring'
  const onSubagents = working && !leftBehind && isAgentStatusHeldOpenByChildWork(row)
  return {
    turnRunning: working && !turnFailed && !leftBehind && !onSubagents,
    shellRunning: false,
    pendingApproval: row.state === 'blocked' || (row.state === 'waiting' && !question),
    pendingQuestion: question,
    turnFailed,
    runningSubagents: onSubagents ? 1 : 0,
    // A hook names the last tool, not whether its call still stands.
    waitsOnBackgroundTask: false,
    // A `done` row in a live pane is a finished turn: no hook says the agent has had none.
    hadTurn: true,
    ended: false,
    ...adapter?.cli?.evidenceOf?.(row)
  }
}
