// The judge of background waits, measured: the labelled cases, what Clef Flash answered about
// each, the cut those answers give, and the cases replayed through the app's own code with no
// network. See docs/design/agent-status.md.
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  RECAP_JUDGE_MODELS,
  recapJudgeEstimatedUsd,
  recapJudgeUsd
} from '../../session-recap/scenarios/recap-judge-models.test-fixture'
import { writeRecapScenarioJson } from '../../session-recap/scenarios/recap-scenario-files.test-fixture'
import { recapJudgeKey } from '../../session-recap/session-recap-judge'
import { clefModelNamed, type ClefProviderId } from '../../utility-model/clef-decisions'
import {
  liveClefDecisions,
  liveModelAccount
} from '../../utility-model/live-model-account.test-fixture'
import { UtilityModelError } from '../../utility-model/utility-model-provider'
import {
  BACKGROUND_WAIT_CALIBRATION,
  BACKGROUND_WAIT_QUESTION_BOOK,
  BACKGROUND_WAIT_STANDINGS,
  BACKGROUND_WAIT_STATE_MAX_CHARS,
  backgroundWaitAnswersIn,
  backgroundWaitBody,
  backgroundWaitJudgeIsCalibrated,
  backgroundWaitKey,
  backgroundWaitState
} from '../background-wait-judge'
import {
  createClefBackgroundWaitJudge,
  LiveSessionBackgroundWaits
} from '../live-session-background-waits'
import { SessionSummaryCache } from '../session-summary-cache'
import {
  BACKGROUND_WAIT_SPLITS,
  backgroundWaitCaseEvidence,
  backgroundWaitCaseNow,
  backgroundWaitCaseSession,
  loadBackgroundWaitCases,
  type BackgroundWaitCase
} from './background-wait-cases.test-fixture'
import {
  backgroundWaitCut,
  backgroundWaitReportMarkdown,
  scoreBackgroundWaitJudge,
  type BackgroundWaitJudged
} from './background-wait-scoring.test-fixture'

const env = process.env
/** Ask Clef Flash for every answer not on record, then write the answers, the cut and the report. */
const live = env.BACKGROUND_WAIT_JUDGE_LIVE === '1'
/** Ask the held-out split even when the tune split is not separated: a result, not a tuning run. */
const heldOutAnyway = env.BACKGROUND_WAIT_JUDGE_HELD_OUT === '1'
const maxUsd = Number(env.BACKGROUND_WAIT_JUDGE_MAX_USD ?? 0.25)
const concurrency = Number(env.BACKGROUND_WAIT_JUDGE_CONCURRENCY ?? 4)
const REPO = join(import.meta.dirname, '..', '..', '..', '..')
const FIXTURES = join(import.meta.dirname, '__fixtures__')
const ANSWERS = join(FIXTURES, 'answers-clef-flash.json')
const MEASURED = join(FIXTURES, 'measured.json')
const REQUEST_TIMEOUT_MS = 60_000
const REFUSALS = ['not-configured', 'unauthorized', 'plan-unavailable', 'model-not-found']
const report =
  env.BACKGROUND_WAIT_JUDGE_REPORT ??
  join(REPO, 'docs', 'design', 'background-wait-judge-report.md')

/** What the answers on record give: the app's calibration is pinned to it. */
type Measured = {
  model: string
  questionBook: string
  waitingCut: number
  /** Shown the wrong way round at that cut, by split. */
  wrong: Partial<Record<string, string[]>>
  unanswered: string[]
}

/** What Clef Flash answered about one case, as it gave it. */
type AnswerOnRecord = {
  /** sha256 of the model, the wording and the state it was asked. */
  key: string
  item: string
  answers: unknown
  inputTokens: number | null
  ms: number
  provider: ClefProviderId
}

const MODEL = BACKGROUND_WAIT_CALIBRATION.model
/** Cloudflare's price for it, which OpenRouter charges too. */
const PRICE = RECAP_JUDGE_MODELS.find((model) => clefModelNamed(model.id) === MODEL)!
const cases = await loadBackgroundWaitCases()
const settledByCode = cases.filter((found) => backgroundWaitCaseEvidence(found) === null)
const judgedCases = cases.filter((found) => backgroundWaitCaseEvidence(found) !== null)
const onRecord = new Map<string, AnswerOnRecord>(
  await readFile(ANSWERS, 'utf8')
    .then((raw): AnswerOnRecord[] => JSON.parse(raw))
    .then((records) => records.map((record) => [record.key, record] as const))
    .catch(() => [])
)
const measured: Measured | null = await readFile(MEASURED, 'utf8')
  .then((raw) => JSON.parse(raw))
  .catch(() => null)

function stateOf(found: BackgroundWaitCase) {
  return backgroundWaitState(backgroundWaitCaseEvidence(found)!, backgroundWaitCaseNow(found))
}

const keyOf = (found: BackgroundWaitCase): string => backgroundWaitKey(MODEL, stateOf(found))

function judgedBy(records: ReadonlyMap<string, AnswerOnRecord>): BackgroundWaitJudged[] {
  return judgedCases.map((item) => {
    const record = records.get(keyOf(item))
    return { item, answers: record ? backgroundWaitAnswersIn(record.answers) : null }
  })
}

function measuredFrom(judged: readonly BackgroundWaitJudged[]): Measured {
  const cut = backgroundWaitCut(judged.filter(({ item }) => item.split === 'tune'))
  const { splits } = scoreBackgroundWaitJudge(judged, cut)
  return {
    model: MODEL,
    questionBook: BACKGROUND_WAIT_QUESTION_BOOK,
    waitingCut: cut,
    wrong: Object.fromEntries(
      BACKGROUND_WAIT_SPLITS.flatMap((split) => {
        const of = splits[split]
        return of ? [[split, of.wrong]] : []
      })
    ),
    unanswered: judged.filter(({ answers }) => !answers).map(({ item }) => item.id)
  }
}

/** The keys of a reply and the type under each: enough to see a shape, with none of its content. */
function shapeOf(value: unknown, depth = 0): string {
  if (Array.isArray(value)) {
    return 'array'
  }
  if (typeof value !== 'object' || value === null || depth > 2) {
    return typeof value
  }
  return `{ ${Object.entries(value)
    .map(([key, under]) => `${key}: ${shapeOf(under, depth + 1)}`)
    .join(', ')} }`
}

describe('background wait cases', () => {
  it('holds every standing in both splits, and a state in one split only', () => {
    expect(new Set(cases.map((found) => found.id)).size).toBe(cases.length)
    expect(judgedCases.length).toBeGreaterThanOrEqual(30)
    for (const split of BACKGROUND_WAIT_SPLITS) {
      const held = new Set(
        judgedCases.filter((found) => found.split === split).map((found) => found.truth)
      )
      expect([...held].sort(), split).toEqual([...BACKGROUND_WAIT_STANDINGS].sort())
    }
    const states = judgedCases.map((found) => JSON.stringify(stateOf(found)))
    expect(new Set(states).size).toBe(states.length)
  })

  it('puts every case to the model in a state its host reads whole', () => {
    expect(BACKGROUND_WAIT_STATE_MAX_CHARS).toBeLessThanOrEqual(3000)
    expect(
      judgedCases
        .filter((found) => JSON.stringify(stateOf(found)).length > BACKGROUND_WAIT_STATE_MAX_CHARS)
        .map((found) => found.id)
    ).toEqual([])
    // Nothing of a labelled case is cut: what is measured is what was labelled.
    expect(
      judgedCases
        .filter((found) => {
          const state = stateOf(found)
          return (
            state.final_message !== (found.reply ?? '(the agent said nothing)') ||
            state.background_commands.length !== found.commands.length
          )
        })
        .map((found) => found.id)
    ).toEqual([])
  })

  it('leaves to code every case with nothing running, and none of those is a wait', () => {
    expect(settledByCode.map((found) => found.id)).toEqual([
      'check-back-promise-no-process',
      'waiter-finished-nothing-running',
      'nohup-job-nothing-else',
      'build-finished-nothing-running'
    ])
    expect(settledByCode.filter((found) => found.truth === 'waiting')).toEqual([])
    expect(settledByCode.map((found) => backgroundWaitCaseSession(found).status)).toEqual([
      'your-turn',
      'your-turn',
      'your-turn',
      'your-turn'
    ])
  })
})

describe('the judge of background waits', () => {
  // Nothing is on record until the first live run; from then on the app is pinned to it.
  it.skipIf(live || measured === null)(
    'is Clef Flash alone, on the wording and the cut the answers on record give',
    () => {
      // A held-out split not asked yet is not a split of unanswered cases.
      const judged = judgedBy(onRecord).filter(({ item }) => item.split in measured!.wrong)
      expect(measuredFrom(judged)).toEqual(measured)
      expect(BACKGROUND_WAIT_CALIBRATION).toEqual({
        model: 'clef-flash',
        questionBook: measured!.questionBook,
        waitingCut: measured!.waitingCut
      })
      expect(backgroundWaitJudgeIsCalibrated()).toBe(true)
    }
  )

  // The labelled cases through the app's judge client, its cache and its status rule, with Clef
  // Flash's recorded answers. No model is called.
  it.skipIf(live || measured === null)(
    'shows every labelled wait as waiting on background tasks and every leftover as your turn',
    async () => {
      const shown = await Promise.all(
        judgedCases.map(async (item) => {
          const waits = new LiveSessionBackgroundWaits({
            judge: createClefBackgroundWaitJudge({
              clef: {
                decide: async (model, request) => {
                  const record = onRecord.get(recapJudgeKey(model, request.body))
                  if (!record) {
                    throw new UtilityModelError('bad-response', 'No answer on record')
                  }
                  return record
                }
              },
              cache: new SessionSummaryCache(null)
            }),
            onChange: () => undefined,
            now: () => backgroundWaitCaseNow(item)
          })
          const session = backgroundWaitCaseSession(item)
          waits.decorate(session)
          await new Promise((resolve) => setTimeout(resolve, 0))
          return { item, session: waits.decorate(session) }
        })
      )
      expect(
        shown
          .filter(({ session }) => session.statusSource !== 'classifier')
          .map(({ item }) => item.id)
      ).toEqual([])
      const wrong = (split: string): string[] =>
        shown
          .filter(
            ({ item, session }) =>
              item.split === split &&
              (session.status === 'waiting-task') !== (item.truth === 'waiting')
          )
          .map(({ item }) => item.id)
      expect(wrong('tune')).toEqual([])
      expect(wrong('held-out')).toEqual([])
    }
  )

  it.runIf(live)(
    'asks Clef Flash what is not on record: the tune split, then the held-out split once tune separates',
    { timeout: 30 * 60_000 },
    async () => {
      const clef = liveClefDecisions(await liveModelAccount())
      const records = new Map(onRecord)
      const ms: number[] = []
      let requests = 0
      let unread: string | null = null
      const ask = async (item: BackgroundWaitCase): Promise<void> => {
        const key = keyOf(item)
        if (records.has(key)) {
          return
        }
        requests++
        const started = Date.now()
        try {
          const { answers, inputTokens, provider } = await clef.decide(MODEL, {
            body: backgroundWaitBody(stateOf(item)),
            timeoutMs: REQUEST_TIMEOUT_MS
          })
          if (backgroundWaitAnswersIn(answers) === null) {
            unread = shapeOf(answers)
            return
          }
          ms.push(Date.now() - started)
          records.set(key, { key, item: item.id, answers, inputTokens, ms: ms.at(-1)!, provider })
        } catch (error) {
          const failed = error instanceof UtilityModelError ? error.kind : String(error)
          console.info(`[background-wait-judge] ${item.id}: ${failed}`)
          // A busy service is asked again in the second round; an account that may not ask is not.
          expect(REFUSALS, `Clef Flash is not callable on this account: ${failed}`).not.toContain(
            failed
          )
        }
      }
      const askAll = async (items: BackgroundWaitCase[]): Promise<void> => {
        // One request alone first: a reply the reader does not take says so here, once.
        const [first, ...rest] = items
        if (first) {
          await ask(first)
          expect(unread, 'Clef Flash answered in a shape the reader does not take').toBeNull()
        }
        // A second round asks again for what a busy service left unanswered.
        for (const round of [rest, items]) {
          const queue = [...round]
          const worker = async (): Promise<void> => {
            for (let next = queue.shift(); next; next = queue.shift()) {
              await ask(next)
            }
          }
          await Promise.all(Array.from({ length: concurrency }, worker))
        }
      }
      const of = (split: string): BackgroundWaitCase[] =>
        judgedCases.filter((found) => found.split === split)
      const estimate = judgedCases
        .filter((found) => !records.has(keyOf(found)))
        .reduce(
          (sum, found) => sum + recapJudgeEstimatedUsd(PRICE, backgroundWaitBody(stateOf(found))),
          0
        )
      expect(estimate, 'the estimate is above BACKGROUND_WAIT_JUDGE_MAX_USD').toBeLessThanOrEqual(
        maxUsd
      )

      await askAll(of('tune'))
      const tune = measuredFrom(judgedBy(records).filter(({ item }) => item.split === 'tune'))
      const separated = (tune.wrong.tune ?? []).length === 0 && tune.unanswered.length === 0
      // Held-out answers seen before the wording is settled would make it a second tune split.
      const heldOutHeldBack = !separated && !heldOutAnyway
      if (!heldOutHeldBack) {
        await askAll(of('held-out'))
      }

      // Only answers to what is asked today are kept: a reworded question's old answers go.
      const kept = judgedCases.flatMap((found) => {
        const record = records.get(keyOf(found))
        return record ? [record] : []
      })
      await writeRecapScenarioJson(ANSWERS, kept)
      const judged = judgedBy(records).filter(
        ({ item }) => item.split === 'tune' || !heldOutHeldBack
      )
      const result = measuredFrom(judged)
      await writeRecapScenarioJson(MEASURED, result)
      const inputTokens = kept.reduce((sum, record) => sum + (record.inputTokens ?? 0), 0)
      const markdown = backgroundWaitReportMarkdown({
        model: `${MODEL} on ${[...new Set(kept.map((record) => record.provider))].join(', ')}`,
        questionBook: BACKGROUND_WAIT_QUESTION_BOOK,
        judged,
        settledByCode,
        score: scoreBackgroundWaitJudge(judged, result.waitingCut),
        spend: { asked: requests, inputTokens, usd: recapJudgeUsd(PRICE, inputTokens, 0), ms },
        heldOutHeldBack
      })
      await writeFile(report, markdown)
      console.info(`\n${markdown.slice(0, markdown.indexOf('\n| case |')).trim()}\n`)
      expect(result.unanswered, 'cases Clef Flash gave no usable answer for').toEqual([])
    }
  )
})
