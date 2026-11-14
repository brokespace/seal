import type { HomeChatApprovals } from '../home-chat-approvals'
import { type RepeatGuard, stalledRefusal } from '../engine/home-chat-repeat-guard'
import type { HomeChatTurnRecorder } from '../engine/home-chat-turn-recorder'
import type { HomeChatToolOutcome } from '../thread/home-chat-thread-items'
import {
  HOME_CHAT_TOOLS,
  isHomeChatToolName,
  parseHomeChatToolInput,
  type HomeChatToolName
} from './home-chat-tool-definitions'
import {
  executeHomeChatTool,
  type HomeChatToolContext,
  type HomeChatToolResult
} from './home-chat-tool-executor'
import {
  failureReply,
  invalidArgumentsReply,
  notAnObjectReply,
  unknownToolReply
} from './home-chat-tool-replies'
import { assessHomeChatToolRisk } from './home-chat-tool-risk'

export type HomeChatToolRunContext = Omit<
  HomeChatToolContext,
  'reportProgress' | 'showAttachment'
> & {
  recorder: HomeChatTurnRecorder
  approvals: HomeChatApprovals
  /** This turn's memory of failing calls. */
  guard: RepeatGuard
  /** A tool acted on a machine; the thread remembers the last one. */
  onMachine?: (label: string) => void
}

/** What a tool call answered. Every call gets one: a refusal or failure is a reply, never a throw. */
export type HomeChatToolReply = { text: string; outcome: HomeChatToolOutcome; machine?: string }

export type HomeChatToolCall = { callId: string; tool: string; input: unknown }

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function execute(
  tool: HomeChatToolName,
  input: Record<string, unknown>,
  callId: string,
  ctx: HomeChatToolRunContext
): Promise<HomeChatToolReply> {
  if (ctx.guard.stalled(tool, input)) {
    return { text: stalledRefusal(tool), outcome: 'refusal' }
  }
  const risk = assessHomeChatToolRisk(tool, input)
  if (risk.requiresApproval) {
    ctx.recorder.toolStatus(callId, { status: 'awaiting-approval', approvalReason: risk.reason })
    const entryId = ctx.recorder.entryIdForCall(callId)
    const approved = entryId ? await ctx.approvals.request(ctx.chatId, entryId, ctx.signal) : false
    if (!approved) {
      return {
        text: ctx.signal?.aborted
          ? 'Cancelled: the user stopped the turn before deciding.'
          : 'The user declined this action. Do not retry it or work around it; ask how they want to proceed.',
        outcome: ctx.signal?.aborted ? 'interrupted' : 'denied'
      }
    }
    ctx.recorder.toolStatus(callId, { status: 'running' })
  }
  let result: HomeChatToolResult
  try {
    result = await executeHomeChatTool(tool, input, {
      ...ctx,
      reportProgress: (text) => ctx.recorder.event({ kind: 'progress', text }),
      showAttachment: (attachment) => ctx.recorder.event({ kind: 'attachment', ...attachment })
    })
  } catch (error) {
    if (ctx.signal?.aborted) {
      return { text: 'Cancelled: the user stopped the turn.', outcome: 'interrupted' }
    }
    result = { text: failureReply(tool, error), isError: true }
  }
  if (!result.isError) {
    ctx.guard.succeeded(tool, input)
    return {
      text: result.text,
      outcome: 'ok',
      ...(result.machine ? { machine: result.machine } : {})
    }
  }
  const { note } = ctx.guard.failed(tool, input, result.text)
  return {
    text: note ? `${result.text}\n\n${note}` : result.text,
    outcome: 'error',
    ...(result.machine ? { machine: result.machine } : {})
  }
}

async function answer(
  call: HomeChatToolCall,
  rawInput: Record<string, unknown>,
  ctx: HomeChatToolRunContext
): Promise<HomeChatToolReply> {
  if (ctx.signal?.aborted) {
    return { text: 'Cancelled: the user stopped the turn.', outcome: 'interrupted' }
  }
  if (!isHomeChatToolName(call.tool)) {
    return { text: unknownToolReply(call.tool, Object.keys(HOME_CHAT_TOOLS)), outcome: 'refusal' }
  }
  if (call.input !== undefined && call.input !== null && !isObject(call.input)) {
    return { text: notAnObjectReply(call.tool), outcome: 'refusal' }
  }
  let input: Record<string, unknown>
  try {
    input = parseHomeChatToolInput(call.tool, rawInput)
  } catch (error) {
    return { text: invalidArgumentsReply(call.tool, error), outcome: 'refusal' }
  }
  return execute(call.tool, input, call.callId, ctx)
}

/**
 * Run one model-requested tool call end to end: record it, check it, ask first when risky, execute,
 * and record the answer. The reply always comes back, so the model can recover from its own mistakes.
 */
export async function runHomeChatToolCall(
  call: HomeChatToolCall,
  ctx: HomeChatToolRunContext
): Promise<HomeChatToolReply> {
  const rawInput = isObject(call.input) ? call.input : {}
  ctx.recorder.toolCall({ callId: call.callId, tool: call.tool, input: rawInput })
  const startedAt = Date.now()
  const reply = await answer(call, rawInput, ctx)
  if (reply.machine) {
    ctx.onMachine?.(reply.machine)
  }
  ctx.recorder.toolResult({
    callId: call.callId,
    tool: call.tool,
    content: reply.text,
    outcome: reply.outcome,
    durationMs: Date.now() - startedAt,
    ...(reply.machine ? { machine: reply.machine } : {})
  })
  return reply
}
