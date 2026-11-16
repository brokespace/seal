import { canonicalAgentSessionDigest } from '../../../shared/agent-session/lifecycle/agent-session-mutation-envelope'
import { structuredAgentSessionPayloadFingerprint } from '../../../shared/agent-session/lifecycle/structured-agent-session-mutation'
import {
  structuredAgentSessionMessageSendMutation,
  structuredAgentSessionSendBody
} from '../../../shared/agent-session/requests/structured-agent-session-send-mutation'
import type { LivePermissionAnswerResult } from '../../../shared/live-sessions/live-session-types'
import type { StructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-host'
import { mintAgentSessionOperationId } from '../../runtime/orchestration/mailbox/structured-pointer/structured-pointer-operation-id'
import type { RouteAttempt, StructuredSessionInput } from '../delivery/session-input-routes'
import { structuredPromptId, structuredSessionRequests } from './structured-session-prompts'
import { errorMessage } from '../../../shared/error-message'

type InputHost = Pick<
  StructuredAgentSessionHost,
  'deps' | 'send' | 'sendAnswer' | 'respondToPrompt' | 'currentWork'
>

/** Marks this caller's writes in the chat's journal, as the composer's own key marks its. */
const CALLER = { callerKey: 'trusted-local:live-sessions' }

/** The host admits a new operation up to 24 hours after the time in its id; half of that. */
const SEND_ID_WINDOW_MS = 12 * 60 * 60_000
/** A send id the host refused stays refused, so a retry moves on to the next one. */
const MAX_SEND_IDS = 8

/** The same id for the same message inside a window, in this process and after a restart. */
function sendOperationId(sessionId: string, requestId: string, window: number, attempt: number) {
  const digest = canonicalAgentSessionDigest({
    domain: 'live-session:send',
    sessionId,
    requestId,
    attempt
  })
  return `${String(window * SEND_ID_WINDOW_MS).padStart(13, '0')}-${digest.slice(0, 32)}`
}

type SendId =
  | { kind: 'free'; operationId: string }
  /** The host already holds this message: its journal says what became of it. */
  | { kind: 'taken' }
  | { kind: 'none'; reason: string }

/** The id this message goes under: its first one the host has neither taken nor refused. */
async function freeSendId(
  host: InputHost,
  sessionId: string,
  requestId: string,
  now: number
): Promise<SendId> {
  const window = Math.floor(now / SEND_ID_WINDOW_MS)
  for (let attempt = 0; attempt < MAX_SEND_IDS; attempt += 1) {
    let spent = false
    // The last window too: a message first sent just before this one began keeps that id.
    for (const at of [window - 1, window]) {
      const answer = await host.sendAnswer(
        sessionId,
        sendOperationId(sessionId, requestId, at, attempt)
      )
      switch (answer.kind) {
        case 'absent':
          break
        case 'refused':
        case 'rejected':
        case 'withdrawn':
          spent = true
          break
        case 'unreadable':
          return { kind: 'none', reason: 'The chat cannot say whether it has this message.' }
        case 'waiting':
        case 'accepted':
        case 'unknown':
          return { kind: 'taken' }
      }
    }
    if (!spent) {
      return { kind: 'free', operationId: sendOperationId(sessionId, requestId, window, attempt) }
    }
  }
  return { kind: 'none', reason: 'The chat refused this message too many times.' }
}

export type StructuredSessionInputDeps = {
  host(): InputHost | null
  /** A send the host queued behind the running turn, for the journal's delivery check. */
  onQueued?(sessionId: string, messageId: string, sequence: number, text: string): void
  now?: () => number
}

async function send(
  deps: StructuredSessionInputDeps,
  sessionId: string,
  text: string,
  requestId: string,
  signal: AbortSignal
): Promise<RouteAttempt> {
  const host = deps.host()
  const fence = host?.deps.store.getConversation(sessionId)?.currentFence
  if (!host || fence === undefined) {
    return { outcome: 'unavailable', reason: 'This chat is not open on this host.' }
  }
  let id: SendId
  try {
    id = await freeSendId(host, sessionId, requestId, (deps.now ?? Date.now)())
  } catch (error) {
    return { outcome: 'unavailable', reason: errorMessage(error) }
  }
  if (id.kind === 'taken') {
    return { outcome: 'sent' }
  }
  if (id.kind === 'none') {
    return { outcome: 'unavailable', reason: id.reason }
  }
  if (signal.aborted) {
    return { outcome: 'unavailable', reason: 'The send was cancelled.' }
  }
  try {
    const result = await host.send(CALLER, {
      ...structuredAgentSessionMessageSendMutation({
        sessionId,
        clientOperationId: id.operationId,
        expectedRuntimeFence: fence,
        body: structuredAgentSessionSendBody(text, []),
        delivery: 'queue-if-active'
      }),
      personsMessage: true
    })
    if (!result.ok) {
      // The host could not tell whether it wrote the message: the journal decides.
      return result.refusal.code === 'agent_session_operation_unknown'
        ? { outcome: 'sent' }
        : { outcome: 'unavailable', reason: result.refusal.message }
    }
    if ('queued' in result.value) {
      deps.onQueued?.(sessionId, result.value.queued.messageId, result.cursor.sequence + 1, text)
      return { outcome: 'sent' }
    }
    const { submission } = result.value
    return submission.dispatchState === 'rejected'
      ? { outcome: 'failed', error: submission.reason ?? 'The agent did not take the message.' }
      : { outcome: 'sent' }
  } catch {
    // The call began, so the message may be written: the journal decides.
    return { outcome: 'sent' }
  }
}

async function answer(
  deps: StructuredSessionInputDeps,
  sessionId: string,
  { promptId, optionId }: { promptId: string; optionId: string },
  signal: AbortSignal
): Promise<LivePermissionAnswerResult> {
  const host = deps.host()
  const fence = host?.deps.store.getConversation(sessionId)?.currentFence
  if (!host || fence === undefined) {
    return { ok: false, reason: 'not_answerable', error: 'This chat is not open on this host.' }
  }
  // Only a running agent waits on a prompt, so a chat at rest has none to answer.
  const request = structuredSessionRequests(
    host.currentWork(sessionId)?.actionablePrompts() ?? []
  ).find((pending) => structuredPromptId(pending) === promptId)
  if (!request) {
    return { ok: false, reason: 'prompt_not_pending' }
  }
  if (!request.options.some((option) => option.id === optionId)) {
    return { ok: false, reason: 'option_not_offered' }
  }
  if (signal.aborted) {
    return { ok: false, reason: 'failed', error: 'The answer was cancelled.' }
  }
  const fields = {
    itemId: request.itemId,
    expectedRevision: request.revision,
    // A question takes its answer by question; an approval takes the decision's id.
    ...(request.questionId === undefined
      ? { optionId }
      : { answers: [{ questionId: request.questionId, optionIds: [optionId] }] })
  }
  try {
    const result = await host.respondToPrompt(CALLER, {
      envelope: {
        sessionId,
        clientOperationId: mintAgentSessionOperationId((deps.now ?? Date.now)()),
        expectedRuntimeFence: fence,
        payloadFingerprint: structuredAgentSessionPayloadFingerprint({
          method: `agentSession.respondTo:${request.kind}`,
          sessionId,
          fields
        })
      },
      kind: request.kind,
      ...fields
    })
    if (result.ok) {
      return { ok: true }
    }
    const { refusal } = result
    const reason = refusal.details?.reason
    if (
      refusal.code === 'agent_session_already_resolved' ||
      refusal.code === 'agent_session_item_revision_stale' ||
      reason === 'promptGone' ||
      reason === 'promptOwnerEnded'
    ) {
      return { ok: false, reason: 'prompt_not_pending' }
    }
    if (reason === 'optionRejected') {
      return { ok: false, reason: 'option_not_offered' }
    }
    return {
      ok: false,
      reason: refusal.code === 'agent_session_operation_unknown' ? 'failed' : 'not_answerable',
      error: refusal.message
    }
  } catch (error) {
    return { ok: false, reason: 'failed', error: errorMessage(error) }
  }
}

/** The `structured` route and the chat answer path, through the calls the chat's composer makes. */
export function createStructuredSessionInput(
  deps: StructuredSessionInputDeps
): StructuredSessionInput {
  return {
    send: (sessionId, text, requestId, signal) => send(deps, sessionId, text, requestId, signal),
    answer: (sessionId, reply, signal) => answer(deps, sessionId, reply, signal)
  }
}
