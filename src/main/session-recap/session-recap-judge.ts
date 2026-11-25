// The judge contract: one request and the conversation after it go to one decision model, which
// answers every question of the book with a probability. Code turns the answers into a verdict.
import { createHash } from 'node:crypto'
import type { NativeChatMessage } from '../../shared/native-chat/native-chat-types'
import type {
  RecapJudgeAnswers,
  RecapJudgeCriterion,
  RecapRequest
} from '../../shared/session-recap/session-recap-types'
import { jsonRecord } from '../utility-model/utility-model-http-request'
import type { RecapPassKind } from './session-recap-budget'
import {
  RECAP_JUDGE_QUESTION_IDS,
  RECAP_JUDGE_QUESTIONS,
  type RecapJudgeCalibration,
  type RecapJudgeCuts
} from './session-recap-judge-questions'

/** Everything the questions judge, and nothing else. */
export type RecapJudgeState = { request: string; conversation: string }

/**
 * What the answers make of a request. `left-undone` is the judge saying it is still waiting, which
 * is the only way to "Not addressed"; `open` is no question firing, or no usable answer.
 */
export type RecapJudgeVerdict =
  | 'withdrawn'
  | 'declined'
  | 'addressed'
  | 'partly'
  | 'left-undone'
  | 'open'

// A later word from the user outranks the agent's; the alarm fires only when nothing else does.
const PRECEDENCE: readonly [RecapJudgeCriterion, RecapJudgeVerdict][] = [
  ['withdrawn', 'withdrawn'],
  ['declined', 'declined'],
  ['done', 'addressed'],
  ['did_part', 'partly'],
  ['left_undone', 'left-undone']
]

/** Each question against its own cut, combined in a fixed order. A failed call is `open`. */
export function recapJudgeVerdict(
  answers: RecapJudgeAnswers | null,
  cuts: RecapJudgeCuts
): RecapJudgeVerdict {
  const fired = answers && PRECEDENCE.find(([criterion]) => answers[criterion] > cuts[criterion])
  return fired ? fired[1] : 'open'
}

/** What a decision model is asked: the state and the whole question book, in Workers AI's request. */
export function recapJudgeBody(model: string, state: RecapJudgeState): unknown {
  return {
    model: model.slice(model.lastIndexOf('/') + 1),
    state,
    questions: Object.fromEntries(
      RECAP_JUDGE_QUESTION_IDS.map((id) => {
        const { instructions, criteria } = RECAP_JUDGE_QUESTIONS[id]
        return [id, { type: 'noul', instructions, criteria }]
      })
    )
  }
}

/** The content hash an answer is kept under: the model, the wording and the state it was asked. */
export function recapJudgeKey(model: string, body: unknown): string {
  return createHash('sha256')
    .update(`${model}\n${JSON.stringify(body)}`)
    .digest('hex')
    .slice(0, 32)
}

/** The probability of yes per question; null unless the reply holds one for every question. */
export function recapJudgeAnswersIn(answers: unknown): RecapJudgeAnswers | null {
  const all = jsonRecord(answers)
  const given = (id: RecapJudgeCriterion): number | null => {
    const value = jsonRecord(all?.[id])?.noul
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
      ? value
      : null
  }
  const [done, didPart, declined, withdrawn, leftUndone] = [
    given('done'),
    given('did_part'),
    given('declined'),
    given('withdrawn'),
    given('left_undone')
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

export type RecapJudgeReply =
  | { answers: RecapJudgeAnswers; cached: boolean }
  /** Why there is no answer: the kind of failure only, never the request or a credential. */
  | { failed: string }

/**
 * The one model that judges requests. `ask` never throws and never tries a second model: when it
 * cannot answer, the request keeps the safe default and is asked about again on a later pass.
 */
export type RecapJudge = {
  calibration: RecapJudgeCalibration
  /** False where the judge cannot run at all: no account, or wording its cuts were not set on. */
  available(): boolean
  /** `kind` is the pass asking, whose allowance decides which account may answer. */
  ask(state: RecapJudgeState, signal: AbortSignal, kind: RecapPassKind): Promise<RecapJudgeReply>
}

/** What the engine hands the requests step after the read step of one pass. */
export type RecapRequestsPass = {
  sessionId: string
  kind: RecapPassKind
  /** The requests as they stood before this pass. */
  before: readonly RecapRequest[]
  /** The `asked` items the read step left: each is one request, under the same id. */
  asked: readonly Pick<RecapRequest, 'id' | 'text' | 'messageId' | 'at'>[]
  /** The messages this pass read, where a new request's own message is found. */
  messages: readonly NativeChatMessage[]
  /** The transcript offset this pass read to. */
  coveredTo: number
  signal: AbortSignal
}

/**
 * The step between the read step and the store: it keeps one request per `asked` item and asks the
 * judge where each unsettled one stands. A read step that proposes statuses of its own still goes
 * through here: only this step sets `status` and `judged`.
 */
export type RecapRequestsStep = (pass: RecapRequestsPass) => Promise<RecapRequest[]>
