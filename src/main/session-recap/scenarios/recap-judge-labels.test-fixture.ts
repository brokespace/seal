// The suite's ground truth: where each thing the user asked for stands at each check, labelled from
// the scenario's script alone by someone who saw neither a model's reply nor the scenario's checks.
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as z from 'zod'
import {
  recapScenarioSteps,
  type RecapScenario,
  type RecapScenarioStep
} from './recap-scenario-schema.test-fixture'

/**
 * Where a request stands. `working` is the host's to decide from the turn's state; the rest are
 * judgements of meaning, and each is the reason one judge question is scored against.
 */
export const RECAP_REQUEST_STANDINGS = [
  'working',
  'done',
  'partly',
  'declined',
  'withdrawn',
  'open'
] as const
export type RecapRequestStanding = (typeof RECAP_REQUEST_STANDINGS)[number]

/** Wording and thresholds are tuned on `tune`; a number is only a result on `held-out`. */
export const RECAP_LABEL_SPLITS = ['tune', 'held-out'] as const
export type RecapLabelSplit = (typeof RECAP_LABEL_SPLITS)[number]

const standing = z.strictObject({
  is: z.enum(RECAP_REQUEST_STANDINGS),
  /** The step that decides it. */
  why: z.string().min(1)
})

export const recapLabelsSchema = z.strictObject({
  id: z.string().min(1),
  split: z.enum(RECAP_LABEL_SPLITS),
  requests: z.array(
    z.strictObject({
      /** The user's own words, copied from a user step; the first is where it was first asked. */
      quotes: z.array(z.string().min(1)).min(1),
      /** By check label; a check before the request was made has no entry. */
      at: z.record(z.string(), standing)
    })
  ),
  /** User messages that ask for nothing. */
  notRequests: z.array(z.string().min(1)),
  /** Rules for the whole session, which have no outcome of their own. */
  rules: z.array(z.string().min(1))
})
export type RecapLabels = z.infer<typeof recapLabelsSchema>

const LABELS = join(import.meta.dirname, '__fixtures__', 'labels')

export async function loadRecapLabels(): Promise<RecapLabels[]> {
  const files = (await readdir(LABELS)).filter((file) => file.endsWith('.json')).sort()
  return Promise.all(
    files.map(async (file) => {
      const labels = recapLabelsSchema.parse(JSON.parse(await readFile(join(LABELS, file), 'utf8')))
      if (`${labels.id}.json` !== file) {
        throw new Error(`${file} holds the labels of "${labels.id}"; the two must match`)
      }
      return labels
    })
  )
}

// Rarest first: a scenario is filed under the rarest standing it holds, so each has both splits.
const RARITY: RecapRequestStanding[] = [
  'withdrawn',
  'declined',
  'partly',
  'working',
  'open',
  'done'
]

/** The stratum a scenario is split within: the rarest standing any of its requests reaches. */
export function recapLabelStratum(labels: RecapLabels): RecapRequestStanding | 'no-request' {
  const reached = new Set(
    labels.requests.flatMap((request) => Object.values(request.at).map((found) => found.is))
  )
  return RARITY.find((found) => reached.has(found)) ?? 'no-request'
}

/** One request at one check: what a judge is asked about, and what the answer should be. */
export type RecapJudgedItem = {
  /** `<scenario>#<request number>@<check label>` */
  id: string
  scenario: string
  split: RecapLabelSplit
  truth: RecapRequestStanding
  why: string
  request: string
  /** The scenario's steps from the one that first asks for it up to the check. */
  since: RecapScenarioStep[]
}

function checkAt(steps: readonly RecapScenarioStep[], label: string): number {
  return steps.findIndex((step) => 'check' in step && step.label === label)
}

export function recapJudgedItems(scenario: RecapScenario, labels: RecapLabels): RecapJudgedItem[] {
  const steps = recapScenarioSteps(scenario)
  return labels.requests.flatMap((request, index) => {
    const asked = steps.findIndex((step) => 'user' in step && step.user.includes(request.quotes[0]))
    return Object.entries(request.at).map(([label, found]): RecapJudgedItem => {
      const check = checkAt(steps, label)
      if (asked === -1 || check < asked) {
        throw new Error(`${scenario.id}: "${request.quotes[0]}" is not asked before "${label}"`)
      }
      return {
        id: `${scenario.id}#${index + 1}@${label}`,
        scenario: scenario.id,
        split: labels.split,
        truth: found.is,
        why: found.why,
        request: request.quotes[0],
        since: steps.slice(asked, check)
      }
    })
  })
}
