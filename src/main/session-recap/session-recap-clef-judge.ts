// The judge as the recap runs it: Cloudflare Clef and nothing else. An answer is kept on the hash
// of what was asked, so an unchanged request and conversation are never paid for twice, and every
// call is logged with its model, cost and whether the cache answered.
import type { RecapJudgeAnswers } from '../../shared/session-recap/session-recap-types'
import { LiveSessionJsonStore } from '../live-sessions/live-session-json-store'
import type { SessionSummaryCache } from '../session-summaries/session-summary-cache'
import {
  UtilityModelError,
  type UtilityModelDecision,
  type UtilityModelDecisionRequest
} from '../utility-model/utility-model-provider'
import { estimateRecapTokens, recapNeuronsForTokens } from './session-recap-budget'
import {
  recapJudgeAnswersIn,
  recapJudgeBody,
  recapJudgeKey,
  type RecapJudge
} from './session-recap-judge'
import {
  RECAP_JUDGE_CALIBRATION,
  recapJudgeIsCalibrated,
  type RecapJudgeCalibration
} from './session-recap-judge-questions'

/** One call to the judge. Nothing of the request, the conversation or the account is in it. */
export type RecapJudgeCall = {
  at: number
  model: string
  questionBook: string
  /** The content hash of what was asked. */
  key: string
  cached: boolean
  ms: number
  inputTokens: number | null
  neurons: number
  /** `answered`, or the kind of failure that left the request at its safe default. */
  outcome: string
}

const CACHE_SLOT = 'recap-judge'
const MAX_LOGGED_CALLS = 500

function isRecapJudgeCall(value: unknown): value is RecapJudgeCall {
  return (
    typeof value === 'object' &&
    value !== null &&
    'key' in value &&
    typeof value.key === 'string' &&
    'outcome' in value &&
    typeof value.outcome === 'string' &&
    'at' in value &&
    typeof value.at === 'number'
  )
}

/** The judge's most recent calls, kept on disk for whoever asks what a recap cost and why. */
export class RecapJudgeCallLog {
  private readonly file: LiveSessionJsonStore<RecapJudgeCall>
  private calls: RecapJudgeCall[] = []

  constructor(path: string, log?: (message: string, error?: unknown) => void) {
    this.file = new LiveSessionJsonStore(path, isRecapJudgeCall, log)
  }

  async load(): Promise<void> {
    // Calls made while the file loaded are the newer ones.
    this.calls = [...(await this.file.load()), ...this.calls].slice(-MAX_LOGGED_CALLS)
  }

  record(call: RecapJudgeCall): void {
    this.calls = [...this.calls, call].slice(-MAX_LOGGED_CALLS)
    this.file.save(this.calls)
  }

  recent(): readonly RecapJudgeCall[] {
    return this.calls
  }
}

export type ClefRecapJudgeDeps = {
  /** The Workers AI account's one path for a decision model; throws UtilityModelError. */
  decide: (
    model: string,
    request: UtilityModelDecisionRequest,
    signal?: AbortSignal
  ) => Promise<UtilityModelDecision>
  cache: Pick<SessionSummaryCache, 'get' | 'set'>
  spend: (neurons: number) => void
  record: (call: RecapJudgeCall) => void
  calibration?: RecapJudgeCalibration
  now?: () => number
}

function kept(text: string | null): RecapJudgeAnswers | null {
  try {
    return text === null ? null : recapJudgeAnswersIn(JSON.parse(text))
  } catch {
    return null
  }
}

/** Answers as the model gives them, so the cache holds what `recapJudgeAnswersIn` reads back. */
const asGiven = (answers: RecapJudgeAnswers): string =>
  JSON.stringify(Object.fromEntries(Object.entries(answers).map(([id, noul]) => [id, { noul }])))

export function createClefRecapJudge(deps: ClefRecapJudgeDeps): RecapJudge {
  const calibration = deps.calibration ?? RECAP_JUDGE_CALIBRATION
  const now = (): number => deps.now?.() ?? Date.now()
  return {
    calibration,
    available: () => recapJudgeIsCalibrated(calibration),
    async ask(state, signal) {
      const { model, questionBook } = calibration
      const body = recapJudgeBody(model, state)
      const key = recapJudgeKey(model, body)
      const call = { at: now(), model, questionBook, key, inputTokens: null, neurons: 0 }
      const cached = kept(deps.cache.get(CACHE_SLOT, key))
      if (cached) {
        deps.record({ ...call, cached: true, ms: 0, outcome: 'answered' })
        return { answers: cached, cached: true }
      }
      const started = now()
      try {
        const decision = await deps.decide(model, { body }, signal)
        const inputTokens = decision.inputTokens
        const neurons = recapNeuronsForTokens(
          model,
          inputTokens ?? estimateRecapTokens(JSON.stringify(body).length),
          0
        )
        deps.spend(neurons)
        const answers = recapJudgeAnswersIn(decision.answers)
        const made = { ...call, cached: false, ms: now() - started, inputTokens, neurons }
        if (!answers) {
          deps.record({ ...made, outcome: 'unusable-reply' })
          return { failed: 'unusable-reply' }
        }
        deps.cache.set(CACHE_SLOT, key, asGiven(answers), now())
        deps.record({ ...made, outcome: 'answered' })
        return { answers, cached: false }
      } catch (error) {
        // Whatever went wrong, no other model is asked: its answers would mean something else.
        const failed = error instanceof UtilityModelError ? error.kind : 'error'
        // With no Workers AI account nothing was called, so there is no call to log.
        if (failed !== 'not-configured') {
          deps.record({ ...call, cached: false, ms: now() - started, outcome: failed })
        }
        return { failed }
      }
    }
  }
}
