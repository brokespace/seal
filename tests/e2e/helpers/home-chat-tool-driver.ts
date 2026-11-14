import { randomUUID } from 'node:crypto'
import { expect, type Page } from '@stablyai/playwright-test'
import {
  startFakeChatCompletionsServer,
  type FakeChatCompletionsServer,
  type FakeChatMessage,
  type FakeChatReply,
  type FakeChatRequest
} from '../../../src/main/home-chat/testing/fake-chat-completions-server.test-support'
import type { HomeChatToolName } from '../../../src/main/home-chat/tools/home-chat-tool-definitions'
import type { HomeChatToolStatus } from '../../../src/shared/home-chat/home-chat-types'

/** One tool call exactly as a model emits it: the tool's name and its JSON arguments. */
export type ToolCall = { name: HomeChatToolName; args: Record<string, unknown> }

/** A later call can depend on what earlier calls in the same turn answered (a job id, say). */
export type ToolStep = ToolCall | ((answers: string[]) => ToolCall)

export type ToolOutcome = {
  tool: string
  /** The text the model was given as the tool's result. */
  text: string
  status: HomeChatToolStatus
  /** Seal stopped and asked the user before running it. */
  askedApproval: boolean
}

type TurnState = {
  /** Tool cards that were waiting for the user's approval, now answered. */
  waiting: string[]
  idle: boolean
  finished: boolean
  errors: string[]
  tools: { id: string; tool: string; status: HomeChatToolStatus }[]
}

type Run = { steps: readonly ToolStep[]; finished: boolean; stepError?: unknown }

const RUN_MARK = /tool-run:([0-9a-f-]{36})/

function toolAnswers(messages: readonly FakeChatMessage[]): string[] {
  return messages.filter((message) => message.role === 'tool').map((m) => m.content ?? '')
}

export type HomeChatToolDriver = {
  model: FakeChatCompletionsServer
  /** Runs the calls in order in one assistant turn of a new thread and returns each result. */
  run: (
    page: Page,
    steps: readonly ToolStep[],
    options?: { approve?: boolean; chatId?: string; timeoutMs?: number }
  ) => Promise<{ chatId: string; outcomes: ToolOutcome[] }>
  /**
   * Text that makes whichever assistant turn receives it (a routine's run, a worker's task) make
   * these calls, then answer with `finishedText`.
   */
  script: (steps: readonly ToolStep[]) => { text: string; finishedText: string }
  close: () => Promise<void>
}

/**
 * Stands in for the model only: a Chat Completions endpoint that asks for the scripted tool calls.
 * Everything after the model's reply is the real app: the turn engine, approvals, tools, machines.
 */
export async function startHomeChatToolDriver(): Promise<HomeChatToolDriver> {
  const runs = new Map<string, Run>()
  const respond = (request: FakeChatRequest, index: number): FakeChatReply => {
    const { messages } = request
    const askIndex = messages.findLastIndex(
      (message) => message.role === 'user' && RUN_MARK.test(message.content ?? '')
    )
    const id = RUN_MARK.exec(messages[askIndex]?.content ?? '')?.[1]
    const run = id ? runs.get(id) : undefined
    if (!id || !run || run.finished) {
      return { text: 'Noted.' }
    }
    const answers = toolAnswers(messages.slice(askIndex + 1))
    const step = run.steps[answers.length]
    if (!step) {
      run.finished = true
      return { text: `tool-run-finished:${id}` }
    }
    try {
      const call = typeof step === 'function' ? step(answers) : step
      return { toolCalls: [{ id: `call_${index}`, name: call.name, args: call.args }] }
    } catch (error) {
      // Thrown inside the model endpoint, it would only stall the turn; end it and rethrow in `run`.
      run.stepError = error
      run.finished = true
      return { text: `tool-run-finished:${id}` }
    }
  }
  const model = await startFakeChatCompletionsServer(respond)

  return {
    model,
    close: () => model.close(),
    script: (steps) => {
      const id = randomUUID()
      runs.set(id, { steps, finished: false })
      return { text: `tool-run:${id}`, finishedText: `tool-run-finished:${id}` }
    },
    run: async (page, steps, options = {}) => {
      const id = randomUUID()
      const run: Run = { steps, finished: false }
      runs.set(id, run)
      const chatId =
        options.chatId ??
        (await page.evaluate(async () => (await window.api.homeChat!.create()).id))
      await page.evaluate(({ chat, text }) => window.api.homeChat!.send({ chatId: chat, text }), {
        chat: chatId,
        text: `tool-run:${id}`
      })
      const asked = new Set<string>()
      const done = `tool-run-finished:${id}`
      const readTurn = (): Promise<TurnState> =>
        page.evaluate(
          async ({ chat, approve, doneText }) => {
            const thread = await window.api.homeChat!.get({ chatId: chat })
            const entries = thread?.entries ?? []
            const waiting = entries.flatMap((entry) =>
              entry.kind === 'tool' && entry.status === 'awaiting-approval' ? [entry.id] : []
            )
            for (const entryId of waiting) {
              await window.api.homeChat!.respondApproval({
                chatId: chat,
                entryId,
                approved: approve
              })
            }
            const ask = entries.findLastIndex(
              (entry) => entry.kind === 'user' && entry.text.includes(doneText.slice(-36))
            )
            const after = ask === -1 ? [] : entries.slice(ask + 1)
            return {
              waiting,
              idle: thread?.status === 'idle',
              finished: after.some(
                (entry) => entry.kind === 'assistant' && entry.text.includes(doneText)
              ),
              errors: after.flatMap((entry) => (entry.kind === 'error' ? [entry.text] : [])),
              tools: after.flatMap((entry) =>
                entry.kind === 'tool'
                  ? [{ id: entry.id, tool: entry.tool, status: entry.status }]
                  : []
              )
            }
          },
          { chat: chatId, approve: options.approve !== false, doneText: done }
        )
      let state: TurnState = { waiting: [], idle: false, finished: false, errors: [], tools: [] }
      await expect
        .poll(
          async () => {
            state = await readTurn()
            state.waiting.forEach((entryId) => asked.add(entryId))
            if (state.errors.length > 0) {
              return 'failed'
            }
            return state.finished && state.idle ? 'finished' : JSON.stringify(state.tools)
          },
          {
            timeout: options.timeoutMs ?? 120_000,
            intervals: [150],
            message: 'the assistant turn did not finish; tools so far'
          }
        )
        .toMatch(/^(finished|failed)$/)
      if (state.errors.length > 0) {
        throw new Error(`The assistant turn failed: ${state.errors.join('; ')}`)
      }
      if (run.stepError) {
        throw run.stepError
      }
      const last = model.requests.findLast((request) =>
        request.messages.some((message) => message.content?.includes(`tool-run:${id}`))
      )
      const messages = last?.messages ?? []
      const askIndex = messages.findLastIndex((message) =>
        (message.content ?? '').includes(`tool-run:${id}`)
      )
      const turn = messages.slice(askIndex + 1)
      const answers = toolAnswers(turn)
      const asks = turn.flatMap((message) => message.tool_calls ?? [])
      // The thread shows no card for report_progress, so cards are matched to calls by name.
      const cards = [...state.tools]
      return {
        chatId,
        outcomes: asks.map((ask, index) => {
          const card = cards[0]?.tool === ask.function.name ? cards.shift() : undefined
          return {
            tool: ask.function.name,
            text: answers[index] ?? '',
            status: card?.status ?? 'ok',
            askedApproval: card ? asked.has(card.id) : false
          }
        })
      }
    }
  }
}
