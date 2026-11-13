import { getMainHttpClient } from '../../../network/http-client'
import {
  HOME_CHAT_TOOLS,
  homeChatToolJsonSchema,
  type HomeChatToolName
} from '../../tools/home-chat-tool-definitions'
import type { HomeChatBackendSession, HomeChatTurnContext } from '../home-chat-backend'
import {
  OpenAiStreamAccumulator,
  type OpenAiChatMessage,
  type OpenAiStreamResult
} from './openai-stream-accumulator'

const MAX_STEPS_PER_TURN = 40

export type OpenAiCompatibleSessionOptions = {
  baseUrl: string
  model: string
  apiKey: string | null
  history: OpenAiChatMessage[]
  onHistory: (history: OpenAiChatMessage[]) => void
}

function toolSpecs(): unknown[] {
  return Object.entries(HOME_CHAT_TOOLS).map(([name, spec]) => ({
    type: 'function',
    function: {
      name,
      description: spec.description,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: name is a key of HOME_CHAT_TOOLS.
      parameters: homeChatToolJsonSchema(name as HomeChatToolName)
    }
  }))
}

export function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  return trimmed.endsWith('/chat/completions') ? trimmed : `${trimmed}/chat/completions`
}

type TextPatch = { text?: string; streaming?: boolean; durationMs?: number }
type StreamText = { text: string; startedAt: number; update: (patch: TextPatch) => void }
type StreamHandles = { text: StreamText | null; reasoning: StreamText | null }

function openText(ctx: HomeChatTurnContext, kind: 'assistant' | 'thinking'): StreamText {
  const handle = ctx.writer.create({ kind, text: '', streaming: true })
  return { text: '', startedAt: Date.now(), update: handle.update }
}

async function streamStep(
  options: OpenAiCompatibleSessionOptions,
  messages: OpenAiChatMessage[],
  ctx: HomeChatTurnContext
): Promise<OpenAiStreamResult> {
  const response = await getMainHttpClient().fetch(chatCompletionsUrl(options.baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {})
    },
    body: JSON.stringify({ model: options.model, messages, tools: toolSpecs(), stream: true }),
    signal: ctx.signal
  })
  if (!response.ok || !response.body) {
    const detail = (await response.text().catch(() => '')).slice(0, 500)
    throw new Error(`The model API answered ${response.status}${detail ? `: ${detail}` : ''}`)
  }
  const acc = new OpenAiStreamAccumulator()
  const handles: StreamHandles = { text: null, reasoning: null }
  const decoder = new TextDecoder()
  const reader = response.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      for (const delta of acc.feed(decoder.decode(value, { stream: true }))) {
        const slot = delta.kind === 'reasoning' ? 'reasoning' : 'text'
        const handle = (handles[slot] ??= openText(ctx, slot === 'text' ? 'assistant' : 'thinking'))
        handle.text += delta.text
        handle.update({ text: handle.text })
      }
    }
  } finally {
    reader.releaseLock()
    handles.reasoning?.update({
      streaming: false,
      durationMs: Date.now() - handles.reasoning.startedAt
    })
    handles.text?.update({ streaming: false })
  }
  return acc.result()
}

function parseArguments(raw: string): unknown {
  try {
    return raw.trim() ? JSON.parse(raw) : {}
  } catch {
    return { __invalid_json: raw }
  }
}

/** Seal's own agent loop: the model API plans, Seal runs the tools. No Claude Code or Codex. */
export function createOpenAiCompatibleSession(
  options: OpenAiCompatibleSessionOptions
): HomeChatBackendSession {
  const history = [...options.history]
  return {
    runTurn: async (text, ctx) => {
      if (!options.baseUrl.trim() || !options.model.trim()) {
        throw new Error('Set a base URL and model for the model API in the assistant settings.')
      }
      history.push({ role: 'user', content: text })
      options.onHistory(history)
      try {
        for (let step = 0; step < MAX_STEPS_PER_TURN; step++) {
          const result = await streamStep(
            options,
            [{ role: 'system', content: ctx.systemPrompt }, ...history],
            ctx
          )
          const calls = result.toolCalls
          history.push({
            role: 'assistant',
            content: result.content || null,
            ...(calls.length ? { tool_calls: calls } : {})
          })
          if (calls.length === 0) {
            return
          }
          for (const call of calls) {
            const outcome = ctx.signal.aborted
              ? { text: 'Cancelled by the user.', isError: true }
              : await ctx.runTool(call.function.name, parseArguments(call.function.arguments))
            history.push({ role: 'tool', tool_call_id: call.id, content: outcome.text })
          }
          options.onHistory(history)
          ctx.signal.throwIfAborted()
        }
        ctx.writer.create({
          kind: 'error',
          text: `Stopped after ${MAX_STEPS_PER_TURN} steps. Send a message to continue.`
        })
      } finally {
        options.onHistory(history)
      }
    },
    close: () => Promise.resolve()
  }
}
