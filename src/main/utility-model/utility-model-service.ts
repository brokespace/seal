import type {
  UtilityModelCatalogResult,
  UtilityModelFailure,
  UtilityModelRequest,
  UtilityModelTestResult
} from '../../shared/utility-model/utility-model-types'
import { UtilityModelError, type UtilityModelProvider } from './utility-model-provider'

/** The configured provider and the models to try, preferred first. */
export type UtilityModelBackend = {
  provider: UtilityModelProvider
  models: string[]
}

export type UtilityModelHealth = {
  unavailableModels: UtilityModelFailure[]
  pausedUntil: number | null
  lastFailure: UtilityModelFailure | null
}

export type UtilityModelReply = { text: string; model: string; usedFallback: boolean }

export type UtilityModelServiceDeps = {
  /** Null when no provider is configured on this host. */
  backend: () => Promise<UtilityModelBackend | null>
  now?: () => number
}

const SHORT_RATE_LIMIT_PAUSE_MS = 60_000
/** This many 429s in a row without one success reads as a spent daily allocation, whatever the wording. */
const RATE_LIMITS_BEFORE_DAY_PAUSE = 3

export function nextUtcDayStart(now: number): number {
  const date = new Date(now)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)
}

/**
 * Runs utility model requests for every feature on this host: falls back when the plan refuses a
 * model, and holds all requests after a rate limit so a spent allocation costs nothing more.
 */
export class UtilityModelService {
  private readonly unavailable = new Map<string, UtilityModelFailure>()
  private readonly listeners = new Set<() => void>()
  private pausedUntil: number | null = null
  private lastFailure: UtilityModelFailure | null = null
  private rateLimitsInARow = 0

  constructor(private readonly deps: UtilityModelServiceDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  async isConfigured(): Promise<boolean> {
    return (await this.deps.backend()) !== null
  }

  health(): UtilityModelHealth {
    this.liftExpiredPause()
    return {
      unavailableModels: [...this.unavailable.values()],
      pausedUntil: this.pausedUntil,
      lastFailure: this.lastFailure
    }
  }

  /** Fires when health changes: a pause starts or ends, or a model turns out unavailable. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** New credentials or models: what the old ones were refused no longer applies. */
  configChanged(): void {
    this.unavailable.clear()
    this.pausedUntil = null
    this.lastFailure = null
    this.rateLimitsInARow = 0
    this.emit()
  }

  /** Background work: throws `rate-limited` without a request while paused. */
  async complete(request: UtilityModelRequest, signal?: AbortSignal): Promise<UtilityModelReply> {
    this.liftExpiredPause()
    if (this.pausedUntil !== null) {
      throw new UtilityModelError('rate-limited', 'Paused after a rate limit')
    }
    return await this.run(request, signal)
  }

  /** A person asked: runs even while paused, and a success lifts the pause. */
  async test(): Promise<UtilityModelTestResult> {
    const startedAt = this.now()
    try {
      const reply = await this.run({
        messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
        maxTokens: 16
      })
      return {
        ok: true,
        model: reply.model,
        reply: reply.text.slice(0, 120),
        elapsedMs: this.now() - startedAt,
        usedFallback: reply.usedFallback
      }
    } catch (error) {
      return { ok: false, failure: this.failureOf(error) }
    }
  }

  async listModels(): Promise<UtilityModelCatalogResult> {
    try {
      const backend = await this.requireBackend()
      return { ok: true, models: await backend.provider.listModels() }
    } catch (error) {
      return { ok: false, failure: this.failureOf(error) }
    }
  }

  private async requireBackend(): Promise<UtilityModelBackend> {
    const backend = await this.deps.backend()
    if (!backend) {
      throw new UtilityModelError('not-configured', 'No utility model provider is configured')
    }
    return backend
  }

  private async run(
    request: UtilityModelRequest,
    signal?: AbortSignal
  ): Promise<UtilityModelReply> {
    const backend = await this.requireBackend()
    const models = [...new Set(backend.models)]
    const candidates = models.filter((model) => !this.unavailable.has(model))
    if (candidates.length === 0) {
      const refused = this.unavailable.get(models[0] ?? '')
      throw new UtilityModelError(
        refused?.kind ?? 'not-configured',
        refused?.message ?? 'No model is configured',
        { model: refused?.model ?? undefined }
      )
    }
    let lastError: unknown = null
    for (const model of candidates) {
      try {
        const text = await backend.provider.complete(model, request, signal)
        this.recordSuccess()
        return { text, model, usedFallback: model !== models[0] }
      } catch (error) {
        if (signal?.aborted) {
          throw error
        }
        lastError = error
        const failure = this.recordFailure(error)
        if (failure.kind !== 'plan-unavailable' && failure.kind !== 'model-not-found') {
          throw error
        }
        this.unavailable.set(model, failure)
        this.emit()
      }
    }
    throw lastError
  }

  private failureOf(error: unknown): UtilityModelFailure {
    return error instanceof UtilityModelError
      ? {
          kind: error.kind,
          message: error.message,
          model: error.detail.model ?? null,
          at: this.now()
        }
      : {
          kind: 'bad-response',
          message: 'The request failed unexpectedly',
          model: null,
          at: this.now()
        }
  }

  private recordSuccess(): void {
    const changed = this.pausedUntil !== null || this.lastFailure !== null
    this.pausedUntil = null
    this.lastFailure = null
    this.rateLimitsInARow = 0
    if (changed) {
      this.emit()
    }
  }

  private recordFailure(error: unknown): UtilityModelFailure {
    const failure = this.failureOf(error)
    this.lastFailure = failure
    if (failure.kind === 'rate-limited' && error instanceof UtilityModelError) {
      this.rateLimitsInARow += 1
      const now = this.now()
      const untilNextDay =
        error.detail.dailyLimit === true || this.rateLimitsInARow >= RATE_LIMITS_BEFORE_DAY_PAUSE
      this.pausedUntil = untilNextDay
        ? nextUtcDayStart(now)
        : now + (error.detail.retryAfterMs ?? SHORT_RATE_LIMIT_PAUSE_MS)
    }
    this.emit()
    return failure
  }

  private liftExpiredPause(): void {
    if (this.pausedUntil !== null && this.pausedUntil <= this.now()) {
      this.pausedUntil = null
      this.emit()
    }
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }
}
