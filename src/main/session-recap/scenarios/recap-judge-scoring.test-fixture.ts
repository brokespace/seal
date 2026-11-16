// How a judge model is scored against the labels: each question on its own, its threshold set on
// the tune split for a bounded loss, and the combined standing reported on the held-out split.
import type { RecapJudgedItem, RecapRequestStanding } from './recap-judge-labels.test-fixture'
import type { RecapJudgeAnswers } from './recap-judge-models.test-fixture'
import {
  RECAP_JUDGE_QUESTION_IDS,
  RECAP_JUDGE_QUESTIONS,
  type RecapJudgeQuestionId
} from './recap-judge-questions.test-fixture'

/** A judged item with the model's answers; null where the call failed or its reply was unusable. */
export type RecapJudged = { item: RecapJudgedItem; answers: RecapJudgeAnswers | null }

export type RecapJudgeCuts = Record<RecapJudgeQuestionId, number>

/** What the recap shows for a request. `open` is the neutral row; `not-addressed` is the alarm. */
export type RecapShownStanding =
  | 'addressed'
  | 'partly'
  | 'declined'
  | 'withdrawn'
  | 'not-addressed'
  | 'open'

const SHOWN: Record<RecapJudgeQuestionId, RecapShownStanding> = {
  done: 'addressed',
  did_part: 'partly',
  declined: 'declined',
  withdrawn: 'withdrawn',
  left_undone: 'not-addressed'
}

// A later word from the user outranks the agent's; the alarm fires only when nothing else does.
const PRECEDENCE: RecapJudgeQuestionId[] = [
  'withdrawn',
  'declined',
  'done',
  'did_part',
  'left_undone'
]

/** Too narrow a spread of answers to rank anything: the question's state or wording is broken. */
const FLAT_RANGE = 0.05

/** The chance a positive outranks a negative, ties counting half; null when either side is empty. */
export function rocAuc(scored: readonly { score: number; positive: boolean }[]): number | null {
  const positives = scored.filter((found) => found.positive)
  const negatives = scored.filter((found) => !found.positive)
  if (positives.length === 0 || negatives.length === 0) {
    return null
  }
  let wins = 0
  for (const positive of positives) {
    for (const negative of negatives) {
      wins += positive.score > negative.score ? 1 : positive.score === negative.score ? 0.5 : 0
    }
  }
  return wins / (positives.length * negatives.length)
}

/**
 * The cut a criterion fires above so that it fires on at most `loss` of the items it must not
 * fire on. With none to go by it never fires.
 */
export function cutForLoss(negatives: readonly number[], loss: number): number {
  if (negatives.length === 0) {
    return 1
  }
  const highestFirst = [...negatives].sort((a, b) => b - a)
  return highestFirst[Math.floor(loss * negatives.length)]
}

/** A failed call takes the neutral row: it never raises the alarm and never hides a request. */
export function recapShownStanding(
  answers: RecapJudgeAnswers | null,
  cuts: RecapJudgeCuts
): RecapShownStanding {
  const fired = answers && PRECEDENCE.find((id) => answers[id] > cuts[id])
  return fired ? SHOWN[fired] : 'open'
}

type Tally = { hit: number; of: number }

export type RecapJudgeQuestionScore = {
  /** Requests standing the way a yes means, per split. */
  positives: { tune: number; heldOut: number }
  auc: { tune: number | null; heldOut: number | null }
  flat: boolean
  /** Set on the tune split for the question's loss. */
  cut: number
  /** On the held-out split: the share of its own it fires on, and of the others. */
  catches: Tally
  firesWrongly: Tally
}

export type RecapJudgeScore = {
  items: { tune: number; heldOut: number; midTurn: number; unanswered: number }
  questions: Record<RecapJudgeQuestionId, RecapJudgeQuestionScore>
  /** Held-out requests by how they really stand, then by what the recap would show. */
  shown: Partial<Record<RecapRequestStanding, Partial<Record<RecapShownStanding, number>>>>
  /** Requests that were done and would be listed as not addressed, on either split. */
  mustKeepLost: string[]
  /** Requests partly done, declined or withdrawn that would be listed as not addressed. */
  otherFalseAlarms: string[]
  /** Requests still being worked on that would be listed if the host took the turn for over. */
  midTurnAlarms: string[]
}

const settled = (judged: RecapJudged): boolean => judged.item.truth !== 'working'

function scores(
  judged: readonly RecapJudged[],
  id: RecapJudgeQuestionId
): { score: number; positive: boolean }[] {
  const { truth } = RECAP_JUDGE_QUESTIONS[id]
  return judged.flatMap((found) =>
    found.answers ? [{ score: found.answers[id], positive: found.item.truth === truth }] : []
  )
}

export function recapJudgeCuts(tune: readonly RecapJudged[]): RecapJudgeCuts {
  const cut = (id: RecapJudgeQuestionId): number =>
    cutForLoss(
      scores(tune.filter(settled), id)
        .filter((found) => !found.positive)
        .map((found) => found.score),
      RECAP_JUDGE_QUESTIONS[id].loss
    )
  return {
    done: cut('done'),
    did_part: cut('did_part'),
    declined: cut('declined'),
    withdrawn: cut('withdrawn'),
    left_undone: cut('left_undone')
  }
}

function questionScore(
  id: RecapJudgeQuestionId,
  tune: readonly RecapJudged[],
  heldOut: readonly RecapJudged[],
  cut: number
): RecapJudgeQuestionScore {
  const [onTune, onHeldOut] = [scores(tune, id), scores(heldOut, id)]
  const all = [...onTune, ...onHeldOut].map((found) => found.score)
  const fires = (positive: boolean): Tally => {
    const group = onHeldOut.filter((found) => found.positive === positive)
    return { hit: group.filter((found) => found.score > cut).length, of: group.length }
  }
  return {
    positives: {
      tune: onTune.filter((found) => found.positive).length,
      heldOut: onHeldOut.filter((found) => found.positive).length
    },
    auc: { tune: rocAuc(onTune), heldOut: rocAuc(onHeldOut) },
    flat: all.length > 0 && Math.max(...all) - Math.min(...all) < FLAT_RANGE,
    cut,
    catches: fires(true),
    firesWrongly: fires(false)
  }
}

export function scoreRecapJudge(judged: readonly RecapJudged[]): RecapJudgeScore {
  const tune = judged.filter((found) => settled(found) && found.item.split === 'tune')
  const heldOut = judged.filter((found) => settled(found) && found.item.split === 'held-out')
  const midTurn = judged.filter((found) => !settled(found))
  const cuts = recapJudgeCuts(tune)
  const alarms = (group: readonly RecapJudged[], truths: RecapRequestStanding[]): string[] =>
    group
      .filter(
        (found) =>
          truths.includes(found.item.truth) &&
          recapShownStanding(found.answers, cuts) === 'not-addressed'
      )
      .map((found) => `${found.item.id} (${found.item.split})`)
  const shown: RecapJudgeScore['shown'] = {}
  for (const found of heldOut) {
    const row = (shown[found.item.truth] ??= {})
    const standing = recapShownStanding(found.answers, cuts)
    row[standing] = (row[standing] ?? 0) + 1
  }
  const questions = Object.fromEntries(
    RECAP_JUDGE_QUESTION_IDS.map((id) => [id, questionScore(id, tune, heldOut, cuts[id])])
  ) as Record<RecapJudgeQuestionId, RecapJudgeQuestionScore>
  return {
    items: {
      tune: tune.length,
      heldOut: heldOut.length,
      midTurn: midTurn.length,
      unanswered: judged.filter((found) => found.answers === null).length
    },
    questions,
    shown,
    mustKeepLost: alarms([...tune, ...heldOut], ['done']),
    otherFalseAlarms: alarms([...tune, ...heldOut], ['partly', 'declined', 'withdrawn']),
    midTurnAlarms: alarms(midTurn, ['working'])
  }
}

/** What a run spent on one model. */
export type RecapJudgeSpend = {
  asked: number
  cached: number
  failed: Record<string, number>
  inputTokens: number
  outputTokens: number
  usd: number
  /** Of the calls this run made; a cached answer shows the latency it was recorded with. */
  latencyMs: number[]
}

const share = ({ hit, of }: Tally): string => (of === 0 ? 'n/a' : `${hit}/${of}`)
const auc = (value: number | null): string => (value === null ? 'n/a' : value.toFixed(2))

function percentile(sorted: readonly number[], fraction: number): number | null {
  return sorted.length === 0
    ? null
    : sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))]
}

export function recapJudgeReportMarkdown(
  model: string,
  score: RecapJudgeScore,
  spend: RecapJudgeSpend
): string {
  const latency = [...spend.latencyMs].sort((a, b) => a - b)
  const failures = Object.entries(spend.failed).map(([kind, times]) => `${kind} ×${times}`)
  const named = (ids: readonly string[]): string =>
    ids.length === 0 ? 'none' : ids.map((id) => `\`${id}\``).join(', ')
  const truths = Object.keys(score.shown) as RecapRequestStanding[]
  const columns: RecapShownStanding[] = [
    'addressed',
    'partly',
    'declined',
    'withdrawn',
    'not-addressed',
    'open'
  ]
  return [
    `## ${model}`,
    '',
    `- Items: ${score.items.tune} tune, ${score.items.heldOut} held out, ${score.items.midTurn} mid-turn; ${score.items.unanswered} without a usable answer (shown as "open").`,
    `- Calls: ${spend.asked} asked, ${spend.cached} from the cache, failed: ${failures.join(', ') || 'none'}.`,
    `- Cost: $${spend.usd.toFixed(4)} for ${spend.inputTokens} input and ${spend.outputTokens} output tokens.`,
    `- Latency: median ${percentile(latency, 0.5) ?? 'n/a'} ms, p95 ${percentile(latency, 0.95) ?? 'n/a'} ms over ${latency.length} calls.`,
    `- **Must-keep lost** (done, would be listed as not addressed): ${named(score.mustKeepLost)}`,
    `- Other false alarms (partly, declined or withdrawn, would be listed): ${named(score.otherFalseAlarms)}`,
    `- Listed mid-turn if the host took the turn for over: ${named(score.midTurnAlarms)}`,
    '',
    '| Question | Yes means | Positives tune / held out | AUC tune | AUC held out | Fires above | Catches (held out) | Fires wrongly (held out) | Broken |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...RECAP_JUDGE_QUESTION_IDS.map((id) => {
      const found = score.questions[id]
      return `| \`${id}\` | ${RECAP_JUDGE_QUESTIONS[id].truth} | ${found.positives.tune} / ${found.positives.heldOut} | ${auc(found.auc.tune)} | ${auc(found.auc.heldOut)} | ${found.cut.toFixed(2)} | ${share(found.catches)} | ${share(found.firesWrongly)} | ${found.flat ? 'same answer for everything' : ''} |`
    }),
    '',
    'Held-out requests by how they stand (rows) and what the recap would show (columns):',
    '',
    `| | ${columns.join(' | ')} |`,
    `| --- | ${columns.map(() => '---').join(' | ')} |`,
    ...truths.map(
      (truth) =>
        `| ${truth} | ${columns.map((shown) => score.shown[truth]?.[shown] ?? 0).join(' | ')} |`
    ),
    ''
  ].join('\n')
}
