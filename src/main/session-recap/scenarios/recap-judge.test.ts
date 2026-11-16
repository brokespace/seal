// The recap's judge, measured: the labels the suite is scored against, and what each candidate
// model answers to the question book about every labelled request. See docs/recap-audit/README.md.
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  loadRecapLabels,
  RECAP_LABEL_SPLITS,
  recapJudgedItems,
  recapLabelStratum,
  type RecapJudgedItem
} from './recap-judge-labels.test-fixture'
import {
  askRecapJudge,
  loadRecapJudgeRecords,
  RECAP_JUDGE_MODELS,
  recapJudgeBody,
  recapJudgeEstimatedUsd,
  recapJudgeKey,
  recapJudgeUsd,
  saveRecapJudgeRecords,
  type RecapJudgeModel,
  type RecapJudgeRecord
} from './recap-judge-models.test-fixture'
import {
  RECAP_JUDGE_CALIBRATION,
  RECAP_JUDGE_QUESTION_BOOK,
  recapJudgeIsCalibrated
} from '../session-recap-judge-questions'
import {
  cutForLoss,
  RECAP_JUDGE_SUMMARY_HEAD,
  recapJudgeReportMarkdown,
  recapJudgeSummaryRow,
  recapShownStanding,
  rocAuc,
  scoreRecapJudge,
  type RecapJudgeCuts,
  type RecapJudgeScore,
  type RecapJudgeSpend
} from './recap-judge-scoring.test-fixture'
import { judgeLabelledScenario } from './recap-judge-product-run.test-fixture'
import { recapJudgeState } from './recap-judge-state.test-fixture'
import { liveRecapCredentials } from './recap-live-credentials.test-fixture'
import { loadRecapScenarios, writeRecapScenarioJson } from './recap-scenario-files.test-fixture'
import { recapScenarioSteps } from './recap-scenario-schema.test-fixture'

const env = process.env
/** Ask the real models for every answer not on record, then write the answers, thresholds and report. */
const live = env.RECAP_JUDGE_LIVE === '1'
/** Model names, comma-separated: measure only these. */
const only = env.RECAP_JUDGE_MODELS?.split(',')
/** A live run stops before its first call when the estimate for what it must ask is above this. */
const maxUsd = Number(env.RECAP_JUDGE_MAX_USD ?? 1)
const concurrency = Number(env.RECAP_JUDGE_CONCURRENCY ?? 4)
const REPO = join(import.meta.dirname, '..', '..', '..', '..')
const reportDir = env.RECAP_JUDGE_REPORT ?? join(REPO, 'docs', 'recap-audit', 'evidence', 'judge')
const THRESHOLDS = join(import.meta.dirname, '__fixtures__', 'judge-thresholds.json')

/** What a model's thresholds were set on: a change to any of it is a regression run. */
type RecapJudgeCalibration = {
  questionBook: string
  cuts: RecapJudgeCuts
  unanswered: number
  mustKeepLost: string[]
}

const scenarios = await loadRecapScenarios()
const labels = await loadRecapLabels()
const labelled = labels.flatMap((found) => {
  const scenario = scenarios.find((candidate) => candidate.id === found.id)
  return scenario ? [{ scenario, labels: found }] : []
})
const everyItem = labelled.flatMap((found) => recapJudgedItems(found.scenario, found.labels))
const stateOf = (item: RecapJudgedItem): string => JSON.stringify(recapJudgeState(item))
// Scenarios that tell one story under different conditions give the judge the same state: it counts once.
const items = [
  ...new Map(everyItem.map((item) => [`${item.truth} ${stateOf(item)}`, item])).values()
]
const models = RECAP_JUDGE_MODELS.filter(
  (model) => !only || only.some((name) => model.id.endsWith(`/${name}`))
)
const onRecord = new Map(
  await Promise.all(
    RECAP_JUDGE_MODELS.map(async (model) => [model.id, await loadRecapJudgeRecords(model)] as const)
  )
)
const calibrations: Record<string, RecapJudgeCalibration> = await readFile(THRESHOLDS, 'utf8')
  .then((raw) => JSON.parse(raw))
  .catch(() => ({}))

function asked(model: RecapJudgeModel, item: RecapJudgedItem): { key: string; body: unknown } {
  const body = recapJudgeBody(model, recapJudgeState(item))
  return { key: recapJudgeKey(model, body), body }
}

function scoreOf(model: RecapJudgeModel, records: ReadonlyMap<string, RecapJudgeRecord>) {
  const found = items.map((item) => ({ item, record: records.get(asked(model, item).key) }))
  const score = scoreRecapJudge(
    found.map(({ item, record }) => ({ item, answers: record?.answers ?? null }))
  )
  return { score, records: found.flatMap(({ record }) => (record ? [record] : [])) }
}

function calibrationOf(score: RecapJudgeScore): RecapJudgeCalibration {
  const question = score.questions
  return {
    questionBook: RECAP_JUDGE_QUESTION_BOOK,
    cuts: {
      done: question.done.cut,
      did_part: question.did_part.cut,
      declined: question.declined.cut,
      withdrawn: question.withdrawn.cut,
      left_undone: question.left_undone.cut
    },
    unanswered: score.items.unanswered,
    mustKeepLost: score.mustKeepLost
  }
}

function spendOf(
  model: RecapJudgeModel,
  records: readonly RecapJudgeRecord[],
  ran: { asked: number; failed: Record<string, number> }
): RecapJudgeSpend {
  const inputTokens = records.reduce((sum, record) => sum + (record.inputTokens ?? 0), 0)
  const outputTokens = records.reduce((sum, record) => sum + (record.outputTokens ?? 0), 0)
  return {
    asked: ran.asked,
    cached: records.length - (ran.asked - Object.values(ran.failed).reduce((a, b) => a + b, 0)),
    failed: ran.failed,
    inputTokens,
    outputTokens,
    usd: recapJudgeUsd(model, inputTokens, outputTokens),
    latencyMs: records.map((record) => record.ms)
  }
}

describe('recap judge labels', () => {
  it('labels every scenario from its own user steps, at its own checks', () => {
    expect(labels.map((found) => found.id)).toEqual(scenarios.map((scenario) => scenario.id))
    for (const { scenario, labels: found } of labelled) {
      const steps = recapScenarioSteps(scenario)
      const said = steps.flatMap((step) => ('user' in step ? [step.user] : []))
      const checks = steps.flatMap((step) => ('check' in step ? [step.label] : []))
      const quoted = [
        ...found.requests.flatMap((request) => request.quotes),
        ...found.notRequests,
        ...found.rules
      ]
      expect(
        quoted.filter((quote) => !said.some((text) => text.includes(quote))),
        `${scenario.id}: quotes no user step holds`
      ).toEqual([])
      expect(
        found.requests.flatMap((request) =>
          Object.keys(request.at).filter((label) => !checks.includes(label))
        ),
        `${scenario.id}: labels at a check it does not have`
      ).toEqual([])
    }
  })

  it('keeps a state in one split and under one standing', () => {
    const settled = items.filter((item) => item.truth !== 'working')
    const states = new Map<string, Set<string>>()
    for (const item of settled) {
      const state = stateOf(item)
      states.set(state, (states.get(state) ?? new Set()).add(item.truth))
    }
    expect([...states.values()].filter((truths) => truths.size > 1)).toEqual([])
    const splits = new Map<string, Set<string>>()
    for (const item of everyItem) {
      const state = stateOf(item)
      splits.set(state, (splits.get(state) ?? new Set()).add(item.split))
    }
    expect([...splits.values()].filter((held) => held.size > 1)).toEqual([])
  })

  it('holds every stratum in both splits', () => {
    const splits = new Map<string, Set<string>>()
    for (const found of labels) {
      const stratum = recapLabelStratum(found)
      splits.set(stratum, (splits.get(stratum) ?? new Set()).add(found.split))
    }
    for (const [stratum, held] of splits) {
      expect([...held].sort(), stratum).toEqual([...RECAP_LABEL_SPLITS].sort())
    }
  })
})

describe('recap judge scoring', () => {
  it('ranks a question by how often its own outrank the rest', () => {
    const scored = [
      { score: 0.9, positive: true },
      { score: 0.8, positive: false },
      { score: 0.7, positive: true },
      { score: 0.1, positive: false }
    ]
    expect(rocAuc(scored)).toBe(0.75)
    expect(
      rocAuc([
        { score: 0.5, positive: true },
        { score: 0.5, positive: false }
      ])
    ).toBe(0.5)
    expect(rocAuc([{ score: 0.5, positive: true }])).toBeNull()
  })

  it('cuts a question where it fires on no more of the rest than its loss allows', () => {
    expect(cutForLoss([0.1, 0.4, 0.2], 0)).toBe(0.4)
    expect(cutForLoss([0.9, 0.5, 0.3, 0.2, 0.1], 0.2)).toBe(0.5)
    expect(cutForLoss([], 0)).toBe(1)
  })

  it('raises the alarm only when nothing else fires, and never on a failed call', () => {
    const cuts = { done: 0.5, did_part: 0.5, declined: 0.5, withdrawn: 0.5, left_undone: 0.5 }
    const none = { done: 0.1, did_part: 0.1, declined: 0.1, withdrawn: 0.1, left_undone: 0.1 }
    expect(recapShownStanding({ ...none, left_undone: 0.9 }, cuts)).toBe('not-addressed')
    expect(recapShownStanding({ ...none, left_undone: 0.9, done: 0.6 }, cuts)).toBe('addressed')
    expect(recapShownStanding(none, cuts)).toBe('open')
    expect(recapShownStanding(null, cuts)).toBe('open')
  })
})

describe('the judge the recap runs', () => {
  it('is Clef alone, pinned to the wording and the thresholds measured for it', () => {
    expect(RECAP_JUDGE_CALIBRATION).toEqual({
      model: '@cf/cloudflare/clef',
      questionBook: 'ba879810db9d',
      cuts: {
        done: 0.3785,
        did_part: 0.9532,
        declined: 0.9255,
        withdrawn: 0.2911,
        left_undone: 0.5738
      }
    })
    expect(recapJudgeIsCalibrated()).toBe(true)
    const { questionBook, cuts } = calibrations[RECAP_JUDGE_CALIBRATION.model]
    expect({ questionBook, cuts }).toEqual({
      questionBook: RECAP_JUDGE_CALIBRATION.questionBook,
      cuts: RECAP_JUDGE_CALIBRATION.cuts
    })
  })
})

describe('the recap judged by its own code', () => {
  // The labelled suite through the app's transcript readers, the conversation reader, the requests
  // step, the Clef client and the display rule, with Clef's recorded answers. No model is called.
  it(
    'never calls a finished request not addressed, and still catches what was left',
    { timeout: 120_000 },
    async () => {
      const records = onRecord.get(RECAP_JUDGE_CALIBRATION.model) ?? new Map()
      const judged = (
        await Promise.all(
          labelled.flatMap((found) =>
            found.scenario.surfaces.map((surface) =>
              judgeLabelledScenario(found.scenario, found.labels, surface, records)
            )
          )
        )
      ).flat()
      const ids = (found: typeof judged): string[] =>
        [...new Set(found.map((entry) => `${entry.item.id} on ${entry.surface}`))].sort()

      // On every surface: the alarm is never raised on finished work or on a turn still running.
      expect(
        ids(
          judged.filter(
            (found) =>
              (found.item.truth === 'done' || found.item.truth === 'working') &&
              found.display === 'not-addressed'
          )
        )
      ).toEqual([])

      // The readers hand the judge the state its thresholds were measured on, but for these. A
      // pasted stack trace loses its indentation, as all recap prose does. A chat's journal holds
      // a question as a plain row without the pick, and a running turn's last row not yet.
      const differs = (surface: string): string[] => [
        ...new Set(
          judged
            .filter((found) => found.surface === surface && !found.sameState)
            .map((found) => found.item.scenario)
        )
      ]
      expect(differs('claude-cli')).toEqual(['ask-in-the-middle-of-a-long-message'])
      expect(differs('claude-ssh')).toEqual([])
      expect(differs('codex-cli')).toEqual(['ask-in-the-middle-of-a-long-message'])
      expect(differs('chat-journal').sort()).toEqual([
        'ask-in-the-middle-of-a-long-message',
        'many-asks-in-one-long-turn',
        'mid-turn-automatic-recap',
        'mid-turn-first-look',
        'mid-turn-refresh',
        'question-tool-answered',
        'question-tool-waiting',
        'second-ask-sent-while-the-agent-works'
      ])
      expect(ids(judged.filter((found) => found.sameState && !found.answered))).toEqual([])

      // Counted as the measurement counts: each scenario on its first surface, each state once.
      const counted = [
        ...new Map(
          judged
            .filter((found) => {
              const scenario = scenarios.find((candidate) => candidate.id === found.item.scenario)
              return found.surface === scenario?.surfaces[0]
            })
            .map((found) => [`${found.item.truth} ${stateOf(found.item)}`, found])
        ).values()
      ]
      const shown = (truth: string, split: string, display?: string): number =>
        counted.filter(
          (found) =>
            found.item.truth === truth &&
            found.item.split === split &&
            (!display || found.display === display)
        ).length
      expect(shown('done', 'tune') + shown('done', 'held-out')).toBe(142)
      expect(
        shown('done', 'tune', 'not-addressed') + shown('done', 'held-out', 'not-addressed')
      ).toBe(0)
      expect([shown('open', 'held-out', 'not-addressed'), shown('open', 'held-out')]).toEqual([
        13, 13
      ])
      expect([shown('open', 'tune', 'not-addressed'), shown('open', 'tune')]).toEqual([14, 17])
    }
  )
})

describe('recap judge models', () => {
  for (const model of RECAP_JUDGE_MODELS) {
    const records = onRecord.get(model.id) ?? new Map<string, RecapJudgeRecord>()
    // Nothing on record until the first live run; from then on its thresholds are pinned.
    it.skipIf(live || records.size === 0)(
      `${model.id}: the answers on record give the thresholds on record`,
      () => {
        expect(calibrationOf(scoreOf(model, records).score)).toEqual(calibrations[model.id])
      }
    )
  }

  it.runIf(live)(
    'asks each model what is not on record, within the cost cap',
    { timeout: 4 * 60 * 60_000 },
    async () => {
      const credentials = await liveRecapCredentials()
      const todo = models.map((model) => {
        const records = new Map(onRecord.get(model.id))
        const missing = items
          .map((item) => ({ item, ...asked(model, item) }))
          .filter((found) => !records.has(found.key))
        const estimate = missing.reduce(
          (sum, found) => sum + recapJudgeEstimatedUsd(model, found.body),
          0
        )
        return { model, records, missing, estimate }
      })
      const estimate = todo.reduce((sum, found) => sum + found.estimate, 0)
      for (const found of todo) {
        console.info(
          `[recap-judge] ${found.model.id}: ${found.missing.length} of ${items.length} to ask, about $${found.estimate.toFixed(4)}`
        )
      }
      expect(estimate, 'the estimate is above RECAP_JUDGE_MAX_USD').toBeLessThanOrEqual(maxUsd)

      await mkdir(reportDir, { recursive: true })
      const log = join(reportDir, 'calls.jsonl')
      const sections: string[] = []
      const summary: string[] = []
      for (const { model, records, missing } of todo) {
        const failed: Record<string, number> = {}
        const ask = async (
          next: (typeof missing)[number]
        ): Promise<'answered' | 'refused' | 'failed'> => {
          const call = await askRecapJudge(model, next.body, credentials, (url, init) =>
            fetch(url, init)
          )
          const entry = { model: model.id, item: next.item.id, key: next.key, cached: false }
          if ('failed' in call) {
            failed[call.failed] = (failed[call.failed] ?? 0) + 1
            await appendFile(log, `${JSON.stringify({ ...entry, ...call })}\n`)
            return call.refused ? 'refused' : 'failed'
          }
          records.set(next.key, { key: next.key, item: next.item.id, ...call })
          const usd = recapJudgeUsd(model, call.inputTokens ?? 0, call.outputTokens ?? 0)
          await appendFile(
            log,
            `${JSON.stringify({ ...entry, ms: call.ms, inputTokens: call.inputTokens, outputTokens: call.outputTokens, usd })}\n`
          )
          return 'answered'
        }
        // One request alone first: an account that may not run the model says so here, once.
        const [first, ...rest] = missing
        if (first && (await ask(first)) === 'refused') {
          const why = Object.keys(failed)[0]
          sections.push(
            `## ${model.id}\n\nNot callable with this credential: ${why}. Nothing was measured.\n`
          )
          summary.push(`| ${model.id} | not callable: ${why} | | | | | | |`)
          continue
        }
        // A second round asks again for what a busy service left unanswered.
        for (const round of [rest, null]) {
          const queue = round ?? missing.filter((found) => !records.has(found.key))
          const worker = async (): Promise<void> => {
            for (let next = queue.shift(); next; next = queue.shift()) {
              await ask(next)
            }
          }
          await Promise.all(Array.from({ length: concurrency }, worker))
        }
        const { score, records: used } = scoreOf(model, records)
        for (const record of used.filter((found) => !missing.some((m) => m.key === found.key))) {
          await appendFile(
            log,
            `${JSON.stringify({ model: model.id, item: record.item, key: record.key, cached: true })}\n`
          )
        }
        // Only answers to what is asked today are kept: a reworded question's old answers go.
        await saveRecapJudgeRecords(model, used)
        calibrations[model.id] = calibrationOf(score)
        const spend = spendOf(model, used, { asked: missing.length, failed })
        sections.push(recapJudgeReportMarkdown(model.id, score, spend))
        summary.push(recapJudgeSummaryRow(model.id, score, spend))
      }
      await writeRecapScenarioJson(THRESHOLDS, calibrations)
      const standings = new Map<string, number>()
      for (const item of items) {
        const key = `${item.truth} (${item.split})`
        standings.set(key, (standings.get(key) ?? 0) + 1)
      }
      await writeFile(
        join(reportDir, 'report.md'),
        [
          '# Recap judge measurement',
          '',
          `Question book \`${RECAP_JUDGE_QUESTION_BOOK}\`. ${items.length} labelled requests-at-a-check from ${labelled.length} scenarios: ${[...standings].map(([key, n]) => `${n} ${key}`).join(', ')}.`,
          '',
          'Thresholds are set on the tune split; every "held out" number is on scenarios the thresholds never saw. The suite over-samples hard cases and is not weighted to real sessions, so rates here are for the suite. With this few items in a class, one item moves a rate by several points.',
          '',
          RECAP_JUDGE_SUMMARY_HEAD,
          ...summary,
          '',
          ...sections
        ].join('\n')
      )
    }
  )
})
