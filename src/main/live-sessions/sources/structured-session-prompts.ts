import { agentSessionPromptQuestions } from '../../../shared/agent-session/agent-session-question-answer'
import type { AgentJournalRenderItem } from '../../../shared/agent-session/journal/agent-session-journal-types'
import type { LiveSessionPermissionPrompt } from '../../../shared/live-sessions/live-session-types'
import { oneLine } from '../discovery/transcript-records'

/** A prompt the chat's agent waits on: one pending approval or question item of its journal. */
export type StructuredSessionRequest = {
  itemId: string
  revision: number
  kind: 'approval' | 'question'
  question: string
  /** Empty when one choice cannot answer it: several questions, several picks or typed text. */
  options: { id: string; label: string }[]
  /** The question an option answers, on a question one choice can answer. */
  questionId?: string
}

/** The host refuses an answer to another revision, so each revision is its own prompt. */
export function structuredPromptId(request: Pick<StructuredSessionRequest, 'itemId' | 'revision'>) {
  return `${request.itemId}@${request.revision}`
}

/** The journal's pending prompts, in the order the journal gives them. */
export function structuredSessionRequests(
  items: readonly AgentJournalRenderItem[]
): StructuredSessionRequest[] {
  const requests: StructuredSessionRequest[] = []
  for (const { itemId, revision, body } of items) {
    if (
      (body.kind !== 'approval' && body.kind !== 'question') ||
      body.resolution.state !== 'pending'
    ) {
      continue
    }
    if (body.kind === 'approval') {
      requests.push({
        itemId,
        revision,
        kind: 'approval',
        question: oneLine(body.detail ? `${body.title} ${body.detail}` : body.title, 200),
        options: body.options.map(({ id, label }) => ({ id, label }))
      })
      continue
    }
    const questions = agentSessionPromptQuestions(body)
    const only = questions.length === 1 && !questions[0].multiSelect ? questions[0] : null
    requests.push({
      itemId,
      revision,
      kind: 'question',
      question: oneLine(only?.question || body.question, 200),
      options: (only?.options ?? []).map(({ id, label }) => ({ id, label })),
      ...(only ? { questionId: only.id } : {})
    })
  }
  return requests
}

/** The prompt the session's row shows: an approval blocks a tool, so it goes before a question. */
export function leadingRequest(
  requests: readonly StructuredSessionRequest[]
): StructuredSessionRequest | null {
  return requests.find((request) => request.kind === 'approval') ?? requests[0] ?? null
}

export function permissionFromRequest(
  request: StructuredSessionRequest | null
): LiveSessionPermissionPrompt | null {
  return request && request.options.length > 0
    ? {
        promptId: structuredPromptId(request),
        question: request.question,
        options: request.options
      }
    : null
}
