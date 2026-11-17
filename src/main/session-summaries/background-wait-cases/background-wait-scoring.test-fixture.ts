// How the judge of background waits is scored against the labels: one cut on the probability of
// `waiting`, set on the tune split, and what the app would show at that cut on each split.
import { cutForLoss, rocAuc } from '../../session-recap/scenarios/recap-judge-scoring.test-fixture'
import {
  backgroundWaitStanding,
  type BackgroundWaitAnswers,
  type BackgroundWaitStanding
} from '../background-wait-judge'
import {
  BACKGROUND_WAIT_SPLITS,
  type BackgroundWaitCase,
  type BackgroundWaitSplit
} from './background-wait-cases.test-fixture'

/** A case put to the model with what it answered; null where the call failed. */
export type BackgroundWaitJudged = {
  item: BackgroundWaitCase
  answers: BackgroundWaitAnswers | null
}

const round = (value: number): number => Math.round(value * 10_000) / 10_000

/**
 * Halfway between the likeliest `waiting` the model gave a case that is not a wait and the least
 * likely it gave a wait above that: no leftover of the tune split is ever shown as a wait, since a
 * session stuck on "Waiting on background tasks" hides that it is the user's move, while a wait
 * shown as "Waiting on you" corrects itself when the agent wakes. With no wait above, never.
 */
export function backgroundWaitCut(tune: readonly BackgroundWaitJudged[]): number {
  const chances = (waits: boolean): number[] =>
    tune.flatMap(({ item, answers }) =>
      answers && (item.truth === 'waiting') === waits ? [answers.waiting] : []
    )
  const highestOther = cutForLoss(chances(false), 0)
  const above = chances(true).filter((chance) => chance > highestOther)
  return above.length === 0 ? 1 : round((highestOther + Math.min(...above)) / 2)
}

type Tally = { right: number; of: number }

export type BackgroundWaitSplitScore = {
  /** How well `waiting` ranks the waits above the rest, whatever the cut. */
  auc: number | null
  /** Waits shown as "Waiting on background tasks". */
  waits: Tally
  /** Leftovers and the rest shown as "Waiting on you". */
  others: Tally
  /** The model picked the labelled standing among all three. */
  standings: Tally
  unanswered: string[]
  /** Shown the wrong way round, by case. */
  wrong: string[]
}

export type BackgroundWaitScore = {
  cut: number
  splits: Partial<Record<BackgroundWaitSplit, BackgroundWaitSplitScore>>
}

export function backgroundWaitShown(
  answers: BackgroundWaitAnswers,
  cut: number
): 'waiting-task' | 'your-turn' {
  return backgroundWaitStanding(answers, cut) === 'waiting' ? 'waiting-task' : 'your-turn'
}

function likeliest(answers: BackgroundWaitAnswers): BackgroundWaitStanding {
  return (['waiting', 'leftover', 'other'] as const).reduce((best, standing) =>
    answers[standing] > answers[best] ? standing : best
  )
}

/** Splits nothing was asked of are left out: a held-out split waits for a tune split that separates. */
export function scoreBackgroundWaitJudge(
  judged: readonly BackgroundWaitJudged[],
  cut: number
): BackgroundWaitScore {
  const splits: BackgroundWaitScore['splits'] = {}
  for (const split of BACKGROUND_WAIT_SPLITS) {
    const found = judged.filter(({ item }) => item.split === split)
    const answered = found.flatMap(({ item, answers }) => (answers ? [{ item, answers }] : []))
    if (answered.length === 0) {
      continue
    }
    const right = (waits: boolean): Tally => {
      const of = answered.filter(({ item }) => (item.truth === 'waiting') === waits)
      const shown = waits ? 'waiting-task' : 'your-turn'
      return {
        right: of.filter(({ answers }) => backgroundWaitShown(answers, cut) === shown).length,
        of: of.length
      }
    }
    splits[split] = {
      auc: rocAuc(
        answered.map(({ item, answers }) => ({
          score: answers.waiting,
          positive: item.truth === 'waiting'
        }))
      ),
      waits: right(true),
      others: right(false),
      standings: {
        right: answered.filter(({ item, answers }) => likeliest(answers) === item.truth).length,
        of: answered.length
      },
      unanswered: found.filter(({ answers }) => !answers).map(({ item }) => item.id),
      wrong: answered
        .filter(
          ({ item, answers }) =>
            (backgroundWaitShown(answers, cut) === 'waiting-task') !== (item.truth === 'waiting')
        )
        .map(({ item }) => item.id)
    }
  }
  return { cut, splits }
}

const tally = ({ right, of }: Tally): string => `${right} of ${of}`

export type BackgroundWaitSpend = { asked: number; inputTokens: number; usd: number; ms: number[] }

export function backgroundWaitReportMarkdown(found: {
  model: string
  questionBook: string
  judged: readonly BackgroundWaitJudged[]
  settledByCode: readonly BackgroundWaitCase[]
  score: BackgroundWaitScore
  spend: BackgroundWaitSpend
  heldOutHeldBack: boolean
}): string {
  const { score, judged, spend } = found
  const sorted = [...spend.ms].sort((a, b) => a - b)
  const median = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : null
  const rows = BACKGROUND_WAIT_SPLITS.flatMap((split) => {
    const of = score.splits[split]
    return of
      ? [
          `| ${split} | ${of.auc === null ? 'n/a' : of.auc.toFixed(3)} | ${tally(of.waits)} | ${tally(of.others)} | ${tally(of.standings)} | ${of.wrong.join(', ') || 'none'} | ${of.unanswered.join(', ') || 'none'} |`
        ]
      : [`| ${split} | not asked | | | | | |`]
  })
  const cases = judged.map(({ item, answers }) => {
    const shown = answers ? backgroundWaitShown(answers, score.cut) : 'no answer'
    const ok = answers ? (shown === 'waiting-task') === (item.truth === 'waiting') : false
    const given = answers
      ? `${answers.waiting.toFixed(4)} | ${answers.leftover.toFixed(4)} | ${answers.other.toFixed(4)} | ${answers.reason ?? ''}`
      : ' | | | '
    return `| ${item.id} | ${item.split} | ${item.truth} | ${given} | ${shown} | ${ok ? 'yes' : '**no**'} |`
  })
  return [
    '# Background wait judge measurement',
    '',
    `Model \`${found.model}\`, question book \`${found.questionBook}\`. ${judged.length} labelled cases put to the model; ${found.settledByCode.length} more have nothing running and are settled by code without it (${found.settledByCode.map((item) => item.id).join(', ')}).`,
    '',
    `The agent waits when the probability of \`waiting\` is above **${score.cut}**. The cut is set on the tune split alone; the held-out row is on cases the wording and the cut never saw. With this few cases one case moves a rate by several points.`,
    ...(found.heldOutHeldBack
      ? [
          '',
          'The held-out split was **not asked**: the tune split is not separated yet, so the wording changes first.'
        ]
      : []),
    '',
    '| split | AUC of `waiting` | waits shown as waiting | others shown as your turn | likeliest standing is the label | shown wrongly | no answer |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
    `${spend.asked} requests in this run, ${spend.inputTokens} input tokens on record, $${spend.usd.toFixed(5)}${median === null ? '' : `, median ${median} ms`}.`,
    '',
    '| case | split | label | waiting | leftover | other | reason | shown | right |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...cases,
    ''
  ].join('\n')
}
