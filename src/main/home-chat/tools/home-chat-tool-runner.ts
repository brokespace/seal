import type { HomeChatApprovals } from '../home-chat-approvals'
import type { HomeChatEntryWriter } from '../home-chat-entry-writer'
import {
  isHomeChatToolName,
  parseHomeChatToolInput,
  type HomeChatToolName
} from './home-chat-tool-definitions'
import {
  executeHomeChatTool,
  type HomeChatToolContext,
  type HomeChatToolResult
} from './home-chat-tool-executor'
import { assessHomeChatToolRisk } from './home-chat-tool-risk'

const MAX_UI_OUTPUT_CHARS = 20_000

export type HomeChatToolRunContext = Omit<HomeChatToolContext, 'reportProgress'> & {
  chatId: string
  writer: HomeChatEntryWriter
  approvals: HomeChatApprovals
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Run one model-requested tool call: render it, ask first when risky, then execute. */
export async function runHomeChatToolCall(
  tool: string,
  rawInput: unknown,
  ctx: HomeChatToolRunContext
): Promise<HomeChatToolResult> {
  if (!isHomeChatToolName(tool)) {
    return { text: `Unknown tool ${tool}.`, isError: true }
  }
  let input: Record<string, unknown>
  try {
    input = parseHomeChatToolInput(tool, rawInput)
  } catch (error) {
    return { text: `Invalid arguments for ${tool}: ${errorText(error)}`, isError: true }
  }
  const toolCtx: HomeChatToolContext = {
    ...ctx,
    reportProgress: (text) => ctx.writer.create({ kind: 'progress', text })
  }
  if (tool === 'report_progress') {
    return executeHomeChatTool(tool, input, toolCtx)
  }
  return runVisibleTool(tool, input, ctx, toolCtx)
}

async function runVisibleTool(
  tool: HomeChatToolName,
  input: Record<string, unknown>,
  ctx: HomeChatToolRunContext,
  toolCtx: HomeChatToolContext
): Promise<HomeChatToolResult> {
  const risk = assessHomeChatToolRisk(tool, input)
  const machine = typeof input.machine === 'string' ? input.machine : undefined
  const entry = ctx.writer.create({
    kind: 'tool',
    tool,
    input,
    ...(machine ? { machine } : {}),
    status: risk.requiresApproval ? 'awaiting-approval' : 'running',
    ...(risk.requiresApproval ? { approvalReason: risk.reason } : {})
  })
  if (risk.requiresApproval) {
    const approved = await ctx.approvals.request(ctx.chatId, entry.id, ctx.signal)
    if (!approved) {
      entry.update({ status: 'denied' })
      return {
        text: 'The user declined this action. Do not retry it; ask how they want to proceed.',
        isError: true
      }
    }
    entry.update({ status: 'running' })
  }
  const startedAt = Date.now()
  try {
    const result = await executeHomeChatTool(tool, input, toolCtx)
    entry.update({
      status: result.isError ? 'error' : 'ok',
      output: result.text.slice(0, MAX_UI_OUTPUT_CHARS),
      durationMs: Date.now() - startedAt,
      ...(result.machine ? { machine: result.machine } : {})
    })
    return result
  } catch (error) {
    const text = errorText(error)
    entry.update({ status: 'error', output: text, durationMs: Date.now() - startedAt })
    return { text, isError: true }
  }
}
