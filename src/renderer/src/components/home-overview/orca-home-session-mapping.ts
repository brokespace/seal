import { formatAgentTypeLabel } from '../../../../shared/agent-status/presentation/agent-type-label'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import type { HomeSession, HomeSessionState } from './home-overview-model'

/** The live status fields Home reads beyond what dashboard cards carry. */
export type OrcaSessionStatusFacts = {
  model?: string
  toolName?: string
  interactivePrompt?: string
}

/** Active account per agent type on this machine (Orca switches accounts per provider, not per session). */
export type OrcaActiveAccountsByAgent = Readonly<Record<string, string | undefined>>

const QUESTION_TOOLS = new Set(['AskUserQuestion', 'ask_user', 'request_user_input'])

export function orcaHomeSessionState(
  card: Pick<DashboardCard, 'dotState' | 'verdict'>,
  facts: OrcaSessionStatusFacts | undefined
): HomeSessionState {
  if (card.verdict === 'failed') {
    return 'errored'
  }
  switch (card.dotState) {
    case 'working':
      return 'working'
    case 'blocked':
    case 'waiting': {
      // A pending tool call without a question is an approval prompt; everything else waits for a reply.
      const tool = facts?.toolName?.trim()
      const asksQuestion = Boolean(facts?.interactivePrompt) || (tool && QUESTION_TOOLS.has(tool))
      return tool && !asksQuestion ? 'permission' : 'waiting'
    }
    case 'done':
      return 'done'
    case 'idle':
      return 'idle'
  }
}

export function orcaHomeMachineId(card: Pick<DashboardCard, 'executionHostId'>): string {
  return card.executionHostId ?? 'local'
}

function lastMessage(card: DashboardCard): HomeSession['lastMessage'] {
  const agent = card.lastAgentMessage?.trim()
  if (agent) {
    return { role: 'agent', text: agent }
  }
  const user = card.lastUserMessage?.trim()
  return user ? { role: 'user', text: user } : undefined
}

export function orcaHomeSessionFromCard(
  card: DashboardCard,
  facts: OrcaSessionStatusFacts | undefined,
  context: { localMachineLabel: string; activeAccounts: OrcaActiveAccountsByAgent }
): HomeSession {
  const machineId = orcaHomeMachineId(card)
  const isLocal = machineId === 'local'
  const title = card.conversationName?.trim() || card.task.trim() || card.worktreeName
  const model = facts?.model?.trim()
  const account = isLocal ? context.activeAccounts[card.agentType] : undefined
  return {
    id: card.paneKey,
    state: orcaHomeSessionState(card, facts),
    unseen: card.unseen,
    machineId,
    machineLabel: isLocal ? context.localMachineLabel : card.hostLabel?.trim() || machineId,
    projectId: card.repoId,
    projectName: card.repoName,
    workspaceName: card.worktreeName,
    title,
    agentType: card.agentType,
    agentLabel: formatAgentTypeLabel(card.agentType),
    ...(model ? { model } : {}),
    ...(account ? { account } : {}),
    startedAt: card.startedAt,
    stateChangedAt: card.stateChangedAt,
    finishedAt: card.finishedAt,
    lastMessage: lastMessage(card),
    ...(card.askSummary ? { askSummary: card.askSummary } : {}),
    target: {
      kind: 'orca-pane',
      reveal: {
        repoId: card.repoId,
        worktreeId: card.worktreeId,
        ...(card.executionHostId ? { executionHostId: card.executionHostId } : {}),
        tabId: card.tabId,
        leafId: card.leafId
      }
    }
  }
}
