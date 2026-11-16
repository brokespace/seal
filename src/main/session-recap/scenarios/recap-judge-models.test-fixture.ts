// The models measured as the recap's judge, how each is asked the question book about one state,
// and the answers kept on a hash of what was asked, so a rerun asks only what changed.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  CLOUDFLARE_AI_DEFAULT_FALLBACK_MODEL,
  CLOUDFLARE_AI_DEFAULT_MODEL
} from '../../../shared/utility-model/utility-model-types'
import type { CloudflareAiCredentials } from '../../utility-model/cloudflare-workers-ai-provider'
import {
  clipProviderText,
  jsonRecord,
  jsonText,
  requestUtilityModelJson,
  retryAfterMs,
  type UtilityModelFetch
} from '../../utility-model/utility-model-http-request'
import { UtilityModelError } from '../../utility-model/utility-model-provider'
import type { RecapJudgeAnswers } from '../../../shared/session-recap/session-recap-types'
import {
  recapJudgeAnswersIn as decisionAnswersIn,
  recapJudgeBody as decisionBody,
  recapJudgeKey as keyOf,
  type RecapJudgeState
} from '../session-recap-judge'
import {
  RECAP_JUDGE_QUESTION_IDS,
  RECAP_JUDGE_QUESTIONS,
  type RecapJudgeQuestionId
} from '../session-recap-judge-questions'

export type { RecapJudgeAnswers }

export type RecapJudgeModel = {
  id: string
  /** A decision model answers typed questions with probabilities; a chat model is asked to write them. */
  kind: 'decision' | 'chat'
  /** Cloudflare's list prices on 2026-11-16, in US dollars per million tokens. */
  usdPerMInput: number
  usdPerMOutput: number
}

export const RECAP_JUDGE_MODELS: RecapJudgeModel[] = [
  { id: '@cf/cloudflare/clef', kind: 'decision', usdPerMInput: 0.24, usdPerMOutput: 0 },
  { id: '@cf/cloudflare/clef-flash', kind: 'decision', usdPerMInput: 0.038, usdPerMOutput: 0 },
  { id: CLOUDFLARE_AI_DEFAULT_MODEL, kind: 'chat', usdPerMInput: 0.06, usdPerMOutput: 0.4 },
  { id: CLOUDFLARE_AI_DEFAULT_FALLBACK_MODEL, kind: 'chat', usdPerMInput: 0.1, usdPerMOutput: 0.3 }
]

/** One model's answers about one item. */
export type RecapJudgeRecord = {
  /** sha256 of the model and the request body: the state and the wording it was asked with. */
  key: string
  item: string
  answers: RecapJudgeAnswers
  inputTokens: number | null
  outputTokens: number | null
  ms: number
}

const CHAT_SYSTEM = [
  'You judge one request a user made to a coding agent.',
  "`request` is the user's words. `conversation` is what was said and done after them, oldest first.",
  'Answer each question with a whole number from 0 to 100: how likely it is that the answer is yes.',
  `Reply with one JSON object and nothing else. Its keys are exactly: ${RECAP_JUDGE_QUESTION_IDS.join(', ')}.`
].join('\n')

const CHAT_MAX_TOKENS = 120
const REQUEST_TIMEOUT_MS = 60_000
const ATTEMPTS = 4

const modelName = (model: RecapJudgeModel): string => model.id.slice(model.id.lastIndexOf('/') + 1)

export function recapJudgeBody(model: RecapJudgeModel, state: RecapJudgeState): unknown {
  if (model.kind === 'decision') {
    return decisionBody(model.id, state)
  }
  const questions = RECAP_JUDGE_QUESTION_IDS.map((id) => {
    const { instructions, criteria } = RECAP_JUDGE_QUESTIONS[id]
    return `${id}: ${instructions}\n  yes: ${criteria.true}\n  no: ${criteria.false}`
  })
  return {
    messages: [
      { role: 'system', content: CHAT_SYSTEM },
      {
        role: 'user',
        content: `request:\n${state.request}\n\nconversation:\n${state.conversation}\n\nquestions:\n${questions.join('\n')}`
      }
    ],
    max_tokens: CHAT_MAX_TOKENS,
    // As the app's provider does: a reasoning model otherwise spends the budget thinking.
    chat_template_kwargs: { enable_thinking: false }
  }
}

export function recapJudgeKey(model: RecapJudgeModel, body: unknown): string {
  return keyOf(model.id, body)
}

/** A rough count for the estimate before a run: English prose is about four characters a token. */
export function recapJudgeEstimatedUsd(model: RecapJudgeModel, body: unknown): number {
  const input = JSON.stringify(body).length / 4
  const output = model.kind === 'chat' ? 40 : 0
  return recapJudgeUsd(model, input, output)
}

export function recapJudgeUsd(
  model: RecapJudgeModel,
  inputTokens: number,
  outputTokens: number
): number {
  return (inputTokens * model.usdPerMInput + outputTokens * model.usdPerMOutput) / 1_000_000
}

const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

function written(reply: string): Record<string, unknown> | null {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start === -1 || end < start) {
    return null
  }
  try {
    return jsonRecord(JSON.parse(reply.slice(start, end + 1)))
  } catch {
    return null
  }
}

/** The probability of yes per question, or null when the reply does not hold one for every question. */
export function recapJudgeAnswersIn(
  model: RecapJudgeModel,
  result: Record<string, unknown> | null
): RecapJudgeAnswers | null {
  if (model.kind === 'decision') {
    return decisionAnswersIn(result?.answers)
  }
  const choices = result?.choices
  const first = Array.isArray(choices) ? jsonRecord(choices[0]) : null
  const reply = jsonText(result?.response) ?? jsonText(jsonRecord(first?.message)?.content)
  const given = written(reply ?? '')
  const answer = (id: RecapJudgeQuestionId): number | null => {
    const value = count(given?.[id])
    return value === null || value < 0 || value > 100 ? null : value / 100
  }
  const [done, didPart, declined, withdrawn, leftUndone] = [
    answer('done'),
    answer('did_part'),
    answer('declined'),
    answer('withdrawn'),
    answer('left_undone')
  ]
  if (
    done === null ||
    didPart === null ||
    declined === null ||
    withdrawn === null ||
    leftUndone === null
  ) {
    return null
  }
  return { done, did_part: didPart, declined, withdrawn, left_undone: leftUndone }
}

export type RecapJudgeCall =
  | Omit<RecapJudgeRecord, 'key' | 'item'>
  /** The kind of failure only: nothing of the request, its address or its credential. */
  | {
      failed: string
      ms: number
      /** The service turned the request down: asking again gives the same. */ refused?: true
    }

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** One request to Workers AI, waited out when rate-limited and tried once more when the service fails. */
export async function askRecapJudge(
  model: RecapJudgeModel,
  body: unknown,
  credentials: CloudflareAiCredentials,
  fetchImpl: UtilityModelFetch
): Promise<RecapJudgeCall> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(credentials.accountId)}/ai/run/${model.id}`
  let failed = 'no-attempt'
  let ms = 0
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const started = performance.now()
    try {
      const { response, body: answered } = await requestUtilityModelJson({
        fetchImpl,
        provider: 'Cloudflare',
        url,
        init: { method: 'POST', body: JSON.stringify(body) },
        apiKey: credentials.apiToken,
        model: model.id,
        timeoutMs: REQUEST_TIMEOUT_MS
      })
      ms = Math.round(performance.now() - started)
      if (response.status === 429) {
        failed = 'rate-limited'
        await pause(retryAfterMs(response) ?? 2000 * 2 ** attempt)
        continue
      }
      if (response.status >= 500) {
        failed = `http-${response.status}`
        await pause(2000)
        continue
      }
      const result = jsonRecord(jsonRecord(answered)?.result)
      if (!response.ok || result === null) {
        const errors = jsonRecord(answered)?.errors
        const message = jsonText(jsonRecord(Array.isArray(errors) ? errors[0] : null)?.message)
        const said = (message ?? '').replaceAll(credentials.accountId, '<account>')
        return {
          failed: clipProviderText(`http-${response.status} ${said}`.trim()),
          ms,
          refused: true
        }
      }
      const answers = recapJudgeAnswersIn(model, result)
      if (answers === null) {
        return { failed: 'unusable-reply', ms }
      }
      const usage = jsonRecord(result.usage)
      return {
        answers,
        inputTokens: count(usage?.input_tokens) ?? count(usage?.prompt_tokens),
        outputTokens: count(usage?.output_tokens) ?? count(usage?.completion_tokens),
        ms
      }
    } catch (error) {
      ms = Math.round(performance.now() - started)
      failed = error instanceof UtilityModelError ? error.kind : 'error'
      await pause(2000)
    }
  }
  return { failed, ms }
}

const ANSWERS = join(import.meta.dirname, '__fixtures__', 'judge-answers')
const answersPath = (name: string): string => join(ANSWERS, `${name}.json`)
/** What the judge answered inside the scenario suite's own runs, beside the measurement's answers. */
export const RECAP_SCENARIO_JUDGE_ANSWERS = 'recap-scenarios'

/** `name` is the answers file: a model's measurement by default. */
export async function loadRecapJudgeRecords(
  model: RecapJudgeModel,
  name = modelName(model)
): Promise<Map<string, RecapJudgeRecord>> {
  const records: RecapJudgeRecord[] = await readFile(answersPath(name), 'utf8')
    .then((raw) => JSON.parse(raw))
    .catch(() => [])
  return new Map(records.map((record) => [record.key, record]))
}

export async function saveRecapJudgeRecords(
  model: RecapJudgeModel,
  records: readonly RecapJudgeRecord[],
  name = modelName(model)
): Promise<void> {
  const sorted = [...records].sort(
    (a, b) => a.item.localeCompare(b.item) || a.key.localeCompare(b.key)
  )
  await mkdir(dirname(answersPath(name)), { recursive: true })
  await writeFile(answersPath(name), `${JSON.stringify(sorted, null, 2)}\n`)
}
