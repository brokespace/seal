// What a recap scenario file holds: a session told step by step, and what its recap must say at each check.
import * as z from 'zod'
import {
  RECAP_ITEM_MARKS,
  RECAP_SECTIONS,
  RECAP_WORK_STATES
} from '../../../shared/session-recap/session-recap-types'

/**
 * How the session's conversation is kept, which decides the reader the recap goes through:
 * a Claude or Codex transcript file, that file on an SSH host, or a chat's journal, which is all
 * an OpenCode or a Copilot chat has.
 */
export const RECAP_SCENARIO_SURFACES = [
  'claude-cli',
  'codex-cli',
  'claude-ssh',
  'chat-journal',
  'opencode-chat',
  'copilot-chat'
] as const
export type RecapScenarioSurface = (typeof RECAP_SCENARIO_SURFACES)[number]

/** What the scenario tests, as the audit's matrix groups them. */
export const RECAP_SCENARIO_CATEGORIES = [
  'addressed-same-turn',
  'addressed-later-turn',
  'addressed-implicitly',
  'partly-addressed',
  'multiple-asks',
  'withdrawn-or-changed',
  'declined',
  'question-answered',
  'question-open',
  'long-session',
  'restart-resume',
  'session-end',
  'tool-heavy',
  'subagent',
  'non-english-terse',
  'duplicate-asks',
  'mid-turn',
  'model-failure',
  'agent-surface',
  'remote'
] as const
export type RecapScenarioCategory = (typeof RECAP_SCENARIO_CATEGORIES)[number]

function compiles(source: string): boolean {
  try {
    new RegExp(source, 'i')
    return true
  } catch {
    return false
  }
}

const pattern = z.string().min(1).refine(compiles, 'not a regular expression')
const why = z.string().min(1)

/** One thing the recap must say. `has` and `lacks` are case-insensitive patterns over an item's text. */
const itemCheck = z.strictObject({
  in: z.enum(RECAP_SECTIONS),
  has: pattern.optional(),
  lacks: pattern.optional(),
  /** With `has`: the matching work item is in this state. */
  state: z.enum(RECAP_WORK_STATES).optional(),
  min: z.number().int().optional(),
  max: z.number().int().optional(),
  /** Leave out the items the user ticked or dismissed. */
  open: z.literal(true).optional(),
  why
})

const textCheck = z.strictObject({
  text: z.enum(['title', 'goal', 'standing']),
  has: pattern.optional(),
  lacks: pattern.optional(),
  why
})

/** What the client is told about the recap as a whole. */
const viewCheck = z.strictObject({
  view: z.enum(['state', 'stale', 'degraded', 'failed', 'partial', 'exists', 'model']),
  is: z.union([z.string(), z.boolean()]),
  why
})

const requestCheck = z.strictObject({
  requests: z.strictObject({ min: z.number().int().optional(), max: z.number().int().optional() }),
  why
})

const check = z.union([itemCheck, textCheck, viewCheck, requestCheck])
export type RecapScenarioCheck = z.infer<typeof check>

const toolStep = z.strictObject({
  tool: z.strictObject({
    name: z.string().min(1),
    input: z.record(z.string(), z.unknown()),
    output: z.string().optional()
  })
})

const questionStep = z.strictObject({
  /** The agent's question tool; `answer` is the option the user picked, absent while it waits. */
  question: z.strictObject({
    text: z.string().min(1),
    options: z.array(z.string().min(1)).min(2),
    answer: z.string().optional()
  })
})

const subagentStep = z.strictObject({
  subagent: z.strictObject({
    prompt: z.string().min(1),
    /** What the subagent says in its own transcript. */
    says: z.array(z.string().min(1)),
    result: z.string().min(1)
  })
})

const faultStep = z.strictObject({
  /** The next `times` requests to that model fail this way before any reply is read. */
  fault: z.strictObject({
    kind: z.enum(['timeout', 'http-500', 'rate-limit', 'model-not-found', 'not-json', 'no-text']),
    model: z.enum(['primary', 'fallback']),
    times: z.number().int().min(1)
  })
})

const step = z.union([
  z.strictObject({ user: z.string().min(1) }),
  z.strictObject({ agent: z.string().min(1) }),
  toolStep,
  /** A file the agent edits, by its path. */
  z.strictObject({ edit: z.string().min(1) }),
  questionStep,
  subagentStep,
  /** The agent compacts its context: the transcript gains its summary of what came before. */
  z.strictObject({ compact: z.string().min(1) }),
  /** A record the agent's harness writes into the user's turn, which nobody typed. */
  z.strictObject({ injected: z.string().min(1) }),
  /**
   * The registry reports this status; a turn that ends is `your-turn` or `waiting-input`. On
   * `waiting-subagent` the agent has stopped writing while work it started runs on behind it.
   */
  z.strictObject({
    status: z.enum([
      'working',
      'waiting-subagent',
      'your-turn',
      'waiting-input',
      'idle',
      'done',
      'errored'
    ])
  }),
  /** Time passes: timers that come due run and their passes finish. */
  z.strictObject({ advance: z.number().int().positive() }),
  /** The user opens the session or comes back to the window. */
  z.strictObject({ open: z.literal(true) }),
  /** The user presses Refresh recap. */
  z.strictObject({ refresh: z.literal(true) }),
  /** The app restarts: recaps are read back from disk and timers are gone. */
  z.strictObject({ restart: z.literal(true) }),
  /** The session is resumed into a new transcript under a new id, as `--resume` does. */
  z.strictObject({ resume: z.literal(true) }),
  /** The user ticks or dismisses the first question, action item or not-addressed entry matching the pattern. */
  z.strictObject({ mark: z.strictObject({ item: pattern, as: z.enum(RECAP_ITEM_MARKS) }) }),
  faultStep,
  /** That many routine turns, each a short ask the agent answers at length: what makes a session long. */
  z.strictObject({ filler: z.number().int().min(1) }),
  z.strictObject({ check: z.array(check).min(1), label: z.string().min(1) })
])
export type RecapScenarioStep = z.infer<typeof step>

const FILLER_SERVICES = [
  'billing',
  'catalog',
  'checkout',
  'inventory',
  'invoices',
  'notifications',
  'orders',
  'payments',
  'pricing',
  'profiles',
  'refunds',
  'reports',
  'search',
  'shipping',
  'taxes',
  'vouchers',
  'warehouse',
  'webhooks'
]

/** The scenario's steps with each `filler` written out as the turns it stands for. */
export function recapScenarioSteps(scenario: RecapScenario): RecapScenarioStep[] {
  let turn = 0
  return scenario.steps.flatMap((found): RecapScenarioStep[] => {
    if (!('filler' in found)) {
      return [found]
    }
    return Array.from({ length: found.filler }, () => {
      const name = FILLER_SERVICES[turn % FILLER_SERVICES.length]
      const round = Math.floor(turn++ / FILLER_SERVICES.length) + 1
      const detail = Array.from(
        { length: 8 },
        (_, line) =>
          `Step ${line + 1} of the ${name} move in round ${round}: replaced the direct console calls in src/${name}/part-${line + 1}.ts with the shared logger and kept the fields each call logged.`
      ).join(' ')
      return [
        { user: `Next, move the ${name} service onto the shared logger (round ${round}).` },
        { edit: `/srv/shop/src/${name}/part-1.ts` },
        {
          agent: `Moved the ${name} service onto the shared logger for round ${round}. ${detail} The ${name} tests pass.`
        }
      ]
    }).flat()
  })
}

export const recapScenarioSchema = z.strictObject({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  categories: z.array(z.enum(RECAP_SCENARIO_CATEGORIES)).min(1),
  /** Run once per surface; the first is the one the recorded replies were made on. */
  surfaces: z.array(z.enum(RECAP_SCENARIO_SURFACES)).min(1),
  /** What a correct recap says at the end, in words, for the matrix. */
  expected: z.string().min(1),
  /**
   * No model reply is recorded for it yet, so it runs up to its first model request and stops. The
   * suite fails once it has recordings and still says this: its checks then join the baseline.
   */
  pending: z.literal(true).optional(),
  steps: z.array(step).min(1)
})
export type RecapScenario = z.infer<typeof recapScenarioSchema>
