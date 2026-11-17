import {
  CLOUDFLARE_AI_DEFAULT_FALLBACK_MODEL,
  CLOUDFLARE_AI_DEFAULT_MODEL
} from '../../shared/utility-model/utility-model-types'
import type {
  UtilityModelProviderId,
  UtilityModelRequest
} from '../../shared/utility-model/utility-model-types'
import { LiveSessionJsonStore } from '../live-sessions/live-session-json-store'

/** Neurons per 1,000 tokens, from Workers AI's pricing table. */
const RATES: Record<string, { input: number; output: number }> = {
  [CLOUDFLARE_AI_DEFAULT_MODEL]: { input: 5.5, output: 36.4 },
  [CLOUDFLARE_AI_DEFAULT_FALLBACK_MODEL]: { input: 9.091, output: 27.273 },
  // The judge: $0.24 per million input tokens at $0.011 per thousand neurons; its answers are free.
  '@cf/cloudflare/clef': { input: 21.818, output: 0 }
}
/** A model with no known rate is counted at the dearer of each side. */
const UNKNOWN_RATE = { input: 9.091, output: 36.4 }
const CHARS_PER_TOKEN = 3.5

/**
 * Where a provider's recap spending stops for the day (UTC): passes on sessions still at work first,
 * then passes at a turn's end, then all. A pass runs at every turn end, so the tiers sit above
 * Workers AI's 10,000 free neurons: the last one is about $0.22 a day past the allowance.
 */
export const RECAP_WORKING_DAILY_NEURONS = 5000
export const RECAP_AUTO_DAILY_NEURONS = 20_000
export const RECAP_ASKED_DAILY_NEURONS = 30_000

/** `working` runs while a session works; `auto` when it stops; `asked` is the user opening or refreshing. */
export type RecapPassKind = 'working' | 'auto' | 'asked'

const DAILY_LIMITS: Record<RecapPassKind, number> = {
  working: RECAP_WORKING_DAILY_NEURONS,
  auto: RECAP_AUTO_DAILY_NEURONS,
  asked: RECAP_ASKED_DAILY_NEURONS
}

/** The judge's provider, and the one a tally saved before tallies were per provider belongs to. */
export const RECAP_JUDGE_PROVIDER: UtilityModelProviderId = 'cloudflare-workers-ai'

type BudgetDay = { day: string; neurons: number; provider?: string }

function isBudgetDay(value: unknown): value is BudgetDay {
  return (
    typeof value === 'object' &&
    value !== null &&
    'day' in value &&
    typeof value.day === 'string' &&
    'neurons' in value &&
    typeof value.neurons === 'number' &&
    Number.isFinite(value.neurons) &&
    (!('provider' in value) || typeof value.provider === 'string')
  )
}

/** What a request the provider counted the tokens of cost; a model with no known rate is counted dear. */
export function recapNeuronsForTokens(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const rate = RATES[model] ?? UNKNOWN_RATE
  return (inputTokens / 1000) * rate.input + (outputTokens / 1000) * rate.output
}

/** A rough token count for text the provider did not count. */
export function estimateRecapTokens(chars: number): number {
  return chars / CHARS_PER_TOKEN
}

export function estimateRecapNeurons(
  model: string,
  request: UtilityModelRequest,
  reply: string
): number {
  const inputChars = request.messages.reduce((sum, message) => sum + message.content.length, 0)
  return recapNeuronsForTokens(
    model,
    estimateRecapTokens(inputChars),
    estimateRecapTokens(reply.length)
  )
}

/**
 * This host's own tally of what recaps cost today (UTC, as Cloudflare counts the allocation), one
 * per provider: the read step on another provider leaves the judge's allowance alone.
 */
export class SessionRecapBudget {
  private readonly file: LiveSessionJsonStore<BudgetDay>
  private readonly spent = new Map<string, BudgetDay>()

  constructor(
    path: string,
    private readonly now: () => number = Date.now,
    log?: (message: string, error?: unknown) => void
  ) {
    this.file = new LiveSessionJsonStore(path, isBudgetDay, log)
  }

  async load(): Promise<void> {
    const today = this.today()
    for (const saved of await this.file.load()) {
      const provider = saved.provider ?? RECAP_JUDGE_PROVIDER
      // A spend recorded while loading counts on top of what was saved.
      if (saved.day === today) {
        this.spent.set(provider, {
          day: today,
          provider,
          neurons: saved.neurons + this.day(provider).neurons
        })
      }
    }
  }

  allows(kind: RecapPassKind, provider: string = RECAP_JUDGE_PROVIDER): boolean {
    return this.day(provider).neurons < DAILY_LIMITS[kind]
  }

  spend(neurons: number, provider: string = RECAP_JUDGE_PROVIDER): void {
    const day = this.day(provider)
    this.spent.set(provider, { ...day, neurons: day.neurons + neurons })
    this.file.save([...this.spent.values()])
  }

  private today(): string {
    return new Date(this.now()).toISOString().slice(0, 10)
  }

  private day(provider: string): BudgetDay {
    const today = this.today()
    let day = this.spent.get(provider)
    if (!day || day.day !== today) {
      day = { day: today, provider, neurons: 0 }
      this.spent.set(provider, day)
    }
    return day
  }
}
