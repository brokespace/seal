import {
  utilityModelCandidates,
  type UtilityModelChoice
} from '../../shared/utility-model/utility-model-selection'
import type {
  UtilityModelCatalogEntry,
  UtilityModelCatalogResult,
  UtilityModelFailure,
  UtilityModelProviderId,
  UtilityModelRequest,
  UtilityModelTestResult
} from '../../shared/utility-model/utility-model-types'
import { UtilityModelError, type UtilityModelProvider } from './utility-model-provider'

/** The configured provider and the models it runs when a caller names none, preferred first. */
export type UtilityModelBackend = {
  provider: UtilityModelProvider
  models: string[]
}

export type UtilityModelCallOptions = {
  /** The caller's own model and fallback, tried before the provider's. */
  choice?: Pick<UtilityModelChoice, 'model' | 'fallbackModel'>
}

export type UtilityModelHealth = {
  unavailableModels: UtilityModelFailure[]
  pausedUntil: number | null
  lastFailure: UtilityModelFailure | null
}

export type UtilityModelReply = {
  text: string
  provider: UtilityModelProviderId
  model: string
  usedFallback: boolean
}

export type UtilityModelServiceDeps = {
  /** Null when no provider is configured on this host. */
  backend: () => Promise<UtilityModelBackend | null>
  /** A model list the provider gives anyone, read while it has no account here. */
  publicCatalog?: () => Promise<(() => Promise<UtilityModelCatalogEntry[]>) | undefined>
  now?: () => number
}

const SHORT_RATE_LIMIT_PAUSE_MS = 60_000
/** A request tries at most this many models: a fallback chain is not a retry budget. */
const MAX_MODELS_PER_REQUEST = 3
/** This many 429s in a row without one success reads as a spent daily allocation, whatever the wording. */
const RATE_LIMITS_BEFORE_DAY_PAUSE = 3

export function nextUtcDayStart(now: number): number {
  const date = new Date(now)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)
}

/**
 * Runs one provider's utility model requests for every feature on this host: falls back when a
 * model is refused or its host is limited, and holds all requests after an account rate limit so
 * a spent allocation costs nothing more.
 */
export class UtilityModelService {
  private readonly unavailable = new Map<string, UtilityModelFailure>()
  /** Models resting after a limit of their own, by the time they may be tried again. */
  private readonly cooling = new Map<string, number>()
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
    this.cooling.clear()
    this.pausedUntil = null
    this.lastFailure = null
    this.rateLimitsInARow = 0
    this.emit()
  }

  /** Background work: throws `rate-limited` without a request while paused. */
  async complete(
    request: UtilityModelRequest,
    signal?: AbortSignal,
    options: UtilityModelCallOptions = {}
  ): Promise<UtilityModelReply> {
    this.liftExpiredPause()
    if (this.pausedUntil !== null) {
      throw new UtilityModelError('rate-limited', 'Paused after a rate limit')
    }
    return await this.run(request, signal, options, false)
  }

  /** A person asked: runs even while paused or cooling, and a success lifts the pause. */
  async test(options: UtilityModelCallOptions = {}): Promise<UtilityModelTestResult> {
    const startedAt = this.now()
    try {
      const reply = await this.run(
        {
          messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
          maxTokens: 16
        },
        undefined,
        options,
        true
      )
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
      const publicCatalog = (await this.deps.backend())
        ? undefined
        : await this.deps.publicCatalog?.()
      if (publicCatalog) {
        return { ok: true, models: await publicCatalog() }
      }
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
    signal: AbortSignal | undefined,
    options: UtilityModelCallOptions,
    asked: boolean
  ): Promise<UtilityModelReply> {
    const backend = await this.requireBackend()
    const models = utilityModelCandidates(
      options.choice ?? { model: null, fallbackModel: null },
      backend.models
    ).slice(0, MAX_MODELS_PER_REQUEST)
    const usable = models.filter((model) => !this.unavailable.has(model))
    if (usable.length === 0) {
      const refused = this.unavailable.get(models[0] ?? '')
      throw new UtilityModelError(
        refused?.kind ?? 'not-configured',
        refused?.message ?? 'No model is configured',
        { model: refused?.model ?? undefined }
      )
    }
    const now = this.now()
    const rested = usable.filter((model) => asked || (this.cooling.get(model) ?? 0) <= now)
    if (rested.length === 0) {
      throw this.pauseUntilRested(usable)
    }
    let lastError: unknown = null
    for (const model of rested) {
      try {
        const text = await backend.provider.complete(model, request, signal)
        this.cooling.delete(model)
        this.recordSuccess()
        return { text, provider: backend.provider.id, model, usedFallback: model !== models[0] }
      } catch (error) {
        if (signal?.aborted) {
          throw error
        }
        lastError = error
        const scoped = error instanceof UtilityModelError && error.detail.modelScoped === true
        const failure = this.recordFailure(error, scoped ? model : null)
        if (failure.kind === 'plan-unavailable' || failure.kind === 'model-not-found') {
          this.unavailable.set(model, failure)
          this.emit()
        } else if (!scoped) {
          throw error
        }
      }
    }
    if (usable.every((model) => (this.cooling.get(model) ?? 0) > this.now())) {
      this.pauseUntilRested(usable)
    }
    throw lastError
  }

  /** Every model this call could use is resting: hold the provider until the first one is back. */
  private pauseUntilRested(models: readonly string[]): UtilityModelError {
    const until = Math.min(...models.map((model) => this.cooling.get(model) ?? 0))
    if (this.pausedUntil === null || this.pausedUntil < until) {
      this.pausedUntil = until
      this.emit()
    }
    return new UtilityModelError('rate-limited', 'Paused after a rate limit')
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

  /** `scopedModel`: the limit is that model's alone, so it rests and the provider keeps running. */
  private recordFailure(error: unknown, scopedModel: string | null): UtilityModelFailure {
    const failure = this.failureOf(error)
    this.lastFailure = failure
    if (!(error instanceof UtilityModelError)) {
      this.emit()
      return failure
    }
    const now = this.now()
    // A reset time already past still earns a moment's rest.
    const wait = Math.max(
      now + 1000,
      error.detail.resetAt ?? now + (error.detail.retryAfterMs ?? SHORT_RATE_LIMIT_PAUSE_MS)
    )
    if (scopedModel !== null) {
      this.cooling.set(scopedModel, wait)
    } else if (failure.kind === 'rate-limited') {
      this.rateLimitsInARow += 1
      const untilNextDay =
        error.detail.dailyLimit === true || this.rateLimitsInARow >= RATE_LIMITS_BEFORE_DAY_PAUSE
      this.pausedUntil = untilNextDay ? (error.detail.resetAt ?? nextUtcDayStart(now)) : wait
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
