import type { AgentSessionStatusSummary } from '../../../shared/agent-session/agent-session-wire'
import type { AgentSessionStatusEvidence } from '../../../shared/live-sessions/adapters/agent-session-adapter'
import {
  runningSubagents,
  type LiveSessionActivity
} from '../../../shared/live-sessions/live-session-activity'
import { isShellActivityToolCall } from '../../../shared/native-chat/tools/native-chat-tool-icon'
import { isClaudeBackgroundWaitTool } from '../discovery/claude-transcript-phase'
import type { StructuredSessionRequest } from './structured-session-prompts'

/** A tool call the running turn has not finished. */
export type StructuredToolInFlight = { name: string; input?: unknown }

export type StructuredSessionEvidenceFacts = {
  summary: Pick<AgentSessionStatusSummary, 'status' | 'turnOutcome'>
  requests: readonly StructuredSessionRequest[]
  toolInFlight: StructuredToolInFlight | null
  activity: LiveSessionActivity
  /** The chat is closed, asleep or cannot run on this host, and no agent runs it now. */
  ended: boolean
}

/** What a chat's host knows, as the facts the status module reads. */
export function structuredSessionEvidence(
  facts: StructuredSessionEvidenceFacts
): AgentSessionStatusEvidence {
  const { summary, requests } = facts
  const pendingApproval = requests.some((request) => request.kind === 'approval')
  const turnRunning = summary.status === 'working'
  return {
    turnRunning,
    shellRunning:
      turnRunning && facts.toolInFlight !== null && isShellActivityToolCall(facts.toolInFlight),
    pendingApproval,
    // The host reports `attention` exactly while a prompt waits; unread, it counts as a question.
    pendingQuestion:
      requests.some((request) => request.kind === 'question') ||
      (summary.status === 'attention' && !pendingApproval),
    // An agent that died mid-turn failed its turn too, as the chat's own row shows it.
    turnFailed: summary.turnOutcome === 'failure' || summary.turnOutcome === 'interruption',
    runningSubagents: runningSubagents(facts.activity).length,
    waitsOnBackgroundTask:
      turnRunning &&
      facts.toolInFlight !== null &&
      isClaudeBackgroundWaitTool(facts.toolInFlight.name),
    hadTurn: summary.status !== null,
    ended: facts.ended
  }
}
