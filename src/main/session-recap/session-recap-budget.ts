import {
  CLOUDFLARE_AI_DEFAULT_FALLBACK_MODEL,
  CLOUDFLARE_AI_DEFAULT_MODEL
} from '../../shared/utility-model/utility-model-types'
import type { UtilityModelRequest } from '../../shared/utility-model/utility-model-types'
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
 * Of the 10,000 free neurons a day: where passes on sessions still at work stop, then passes on
 * stops nobody asked for, then all. Each tier leaves room for the one above it.
 */
export const RECAP_WORKING_DAILY_NEURONS = 3000
export const RECAP_AUTO_DAILY_NEURONS = 6000
export const RECAP_ASKED_DAILY_NEURONS = 9000

/** `working` runs while a session works; `auto` when it stops; `asked` is the user opening or refreshing. */
export type RecapPassKind = 'working' | 'auto' | 'asked'

const DAILY_LIMITS: Record<RecapPassKind, number> = {
  working: RECAP_WORKING_DAILY_NEURONS,
  auto: RECAP_AUTO_DAILY_NEURONS,
  asked: RECAP_ASKED_DAILY_NEURONS
}

type BudgetDay = { day: string; neurons: number }

function isBudgetDay(value: unknown): value is BudgetDay {
  return (
    typeof value === 'object' &&
    value !== null &&
    'day' in value &&
    typeof value.day === 'string' &&
    'neurons' in value &&
    typeof value.neurons === 'number' &&
    Number.isFinite(value.neurons)
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

/** This host's own tally of what recaps cost today (UTC, as Cloudflare counts the allocation). */
export class SessionRecapBudget {
  private readonly file: LiveSessionJsonStore<BudgetDay>
  private current: BudgetDay = { day: '', neurons: 0 }

  constructor(
    path: string,
    private readonly now: () => number = Date.now,
    log?: (message: string, error?: unknown) => void
  ) {
    this.file = new LiveSessionJsonStore(path, isBudgetDay, log)
  }

  async load(): Promise<void> {
    const [saved] = await this.file.load()
    // A spend recorded while loading counts on top of what was saved.
    if (saved && saved.day === this.today()) {
      this.current = { day: saved.day, neurons: saved.neurons + this.day().neurons }
    }
  }

  allows(kind: RecapPassKind): boolean {
    return this.day().neurons < DAILY_LIMITS[kind]
  }

  spend(neurons: number): void {
    const day = this.day()
    this.current = { day: day.day, neurons: day.neurons + neurons }
    this.file.save([this.current])
  }

  spentToday(): number {
    return this.day().neurons
  }

  private today(): string {
    return new Date(this.now()).toISOString().slice(0, 10)
  }

  private day(): BudgetDay {
    const today = this.today()
    if (this.current.day !== today) {
      this.current = { day: today, neurons: 0 }
    }
    return this.current
  }
}
