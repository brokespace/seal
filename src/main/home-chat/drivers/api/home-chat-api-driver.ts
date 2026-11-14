import { randomUUID } from 'node:crypto'
import {
  calibratedRatio,
  estimateItemsTokens,
  estimateTextTokens
} from '../../engine/home-chat-compaction'
import {
  CUT_OFF_NUDGE,
  EMPTY_NUDGE,
  ROUND_LIMIT_TEXT,
  SUMMARY_REQUEST,
  systemNote
} from '../../engine/home-chat-system-note'
import type { HomeChatThread } from '../../thread/home-chat-thread'
import { activeItems } from '../../thread/home-chat-thread-history'
import {
  HOME_CHAT_TOOLS,
  homeChatToolJsonSchema,
  PARALLEL_SAFE_TOOLS,
  type HomeChatToolName
} from '../../tools/home-chat-tool-definitions'
import type { HomeChatToolCall } from '../../tools/home-chat-tool-runner'
import type { HomeChatDriver, HomeChatDriverTurn } from '../home-chat-driver'
import {
  ContextOverflowError,
  streamChatCompletion,
  type OpenAiEndpoint
} from './openai-chat-request'
import type { OpenAiStreamResult, OpenAiToolCall } from './openai-stream-accumulator'
import { encodeOpenAiMessages } from './openai-wire-messages'

export const MAX_ROUNDS_PER_TURN = 40
const MAX_EMPTY_NUDGES = 1
const MAX_CUT_OFF_NUDGES = 2

export type HomeChatApiDriverOptions = OpenAiEndpoint & { contextWindow: number }

let toolSpecCache: unknown[] | null = null

function toolSpecs(): unknown[] {
  toolSpecCache ??= Object.entries(HOME_CHAT_TOOLS).map(([name, spec]) => ({
    type: 'function',
    function: {
      name,
      description: spec.description,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: name is a key of HOME_CHAT_TOOLS.
      parameters: homeChatToolJsonSchema(name as HomeChatToolName)
    }
  }))
  return toolSpecCache
}

function toolSpecTokens(): number {
  return estimateTextTokens(JSON.stringify(toolSpecs()))
}

function estimateRequest(thread: HomeChatThread, systemPrompt: string): number {
  return (
    estimateTextTokens(systemPrompt) +
    toolSpecTokens() +
    estimateItemsTokens(activeItems(thread.items))
  )
}

function usedCallIds(thread: HomeChatThread): Set<string> {
  const ids = new Set<string>()
  for (const item of thread.items) {
    if (item.type === 'assistant') {
      for (const part of item.parts) {
        if (part.kind === 'tool_call') {
          ids.add(part.callId)
        }
      }
    }
  }
  return ids
}

function toCall(call: OpenAiToolCall, used: Set<string>): HomeChatToolCall {
  // Some servers reuse ids like `call_0` every round; ids must be unique in the thread.
  const callId = call.id && !used.has(call.id) ? call.id : `call_${randomUUID()}`
  used.add(callId)
  let input: unknown
  try {
    input = call.function.arguments.trim() ? JSON.parse(call.function.arguments) : {}
  } catch {
    input = call.function.arguments
  }
  return { callId, tool: call.function.name, input }
}

async function modelRound(
  options: HomeChatApiDriverOptions,
  turn: HomeChatDriverTurn
): Promise<OpenAiStreamResult> {
  const { thread, recorder, systemPrompt, signal } = turn
  const request = () => {
    const estimated = estimateRequest(thread, systemPrompt)
    return streamChatCompletion(
      options,
      {
        messages: encodeOpenAiMessages(systemPrompt, activeItems(thread.items)),
        tools: toolSpecs()
      },
      signal,
      (delta) => (delta.kind === 'text' ? recorder.text(delta.text) : recorder.thinking(delta.text))
    ).then((result) => ({ result, estimated }))
  }
  let answer: Awaited<ReturnType<typeof request>>
  try {
    answer = await request()
  } catch (error) {
    if (!(error instanceof ContextOverflowError)) {
      throw error
    }
    // The estimate was too low; shrink the context and try once more.
    await turn.compact(true)
    answer = await request()
  }
  const { usage } = answer.result
  if (usage) {
    thread.updateMeta({
      contextTokens: usage.promptTokens + usage.completionTokens,
      tokenRatio: calibratedRatio(thread.meta.tokenRatio, answer.estimated, usage.promptTokens)
    })
  }
  return answer.result
}

async function runCalls(calls: HomeChatToolCall[], turn: HomeChatDriverTurn): Promise<void> {
  for (const call of calls) {
    turn.recorder.toolCall({
      callId: call.callId,
      tool: call.tool,
      input: typeof call.input === 'object' && call.input !== null ? { ...call.input } : {}
    })
  }
  turn.recorder.endRound('tool_calls')
  if (calls.length > 1 && calls.every((call) => PARALLEL_SAFE_TOOLS.has(call.tool))) {
    await Promise.all(calls.map((call) => turn.runTool(call)))
    return
  }
  for (const call of calls) {
    await turn.runTool(call)
  }
}

/**
 * Seal's own agent loop over a Chat Completions endpoint: the model plans, Seal runs the tools.
 * Each round is rebuilt from the thread, so what the model sees is exactly what is stored.
 */
export function createApiDriver(options: HomeChatApiDriverOptions): HomeChatDriver {
  return {
    contextWindow: options.contextWindow,
    contextTokens: (thread, systemPrompt) =>
      Math.round(estimateRequest(thread, systemPrompt) * (thread.meta.tokenRatio ?? 1)),
    runTurn: async (turn) => {
      const { recorder, signal, thread } = turn
      const used = usedCallIds(thread)
      let emptyNudges = 0
      let cutOffNudges = 0
      for (let round = 0; round < MAX_ROUNDS_PER_TURN; round++) {
        // Guards run before a round is paid for.
        signal.throwIfAborted()
        await turn.compact()
        const result = await modelRound(options, turn)
        if (result.toolCalls.length > 0) {
          await runCalls(
            result.toolCalls.map((call) => toCall(call, used)),
            turn
          )
          continue
        }
        if (result.finishReason === 'length') {
          recorder.endRound('cut_off')
          if (cutOffNudges++ < MAX_CUT_OFF_NUDGES) {
            recorder.userMessage(CUT_OFF_NUDGE, 'system')
            continue
          }
          return
        }
        recorder.endRound('end')
        if (result.content.trim()) {
          return
        }
        if (emptyNudges++ < MAX_EMPTY_NUDGES) {
          recorder.userMessage(EMPTY_NUDGE, 'system')
          continue
        }
        recorder.event({ kind: 'error', text: 'The model returned an empty reply. Try again.' })
        return
      }
      recorder.event({ kind: 'error', text: ROUND_LIMIT_TEXT(MAX_ROUNDS_PER_TURN) })
    },
    summarize: async ({ systemPrompt, items, signal }) => {
      const result = await streamChatCompletion(
        options,
        {
          messages: [
            ...encodeOpenAiMessages(systemPrompt, items),
            { role: 'user', content: systemNote(SUMMARY_REQUEST) }
          ]
        },
        signal,
        () => {}
      )
      return result.content.trim()
    }
  }
}
