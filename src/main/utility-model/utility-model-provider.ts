import type {
  UtilityModelCatalogEntry,
  UtilityModelFailureKind,
  UtilityModelProviderId,
  UtilityModelRequest
} from '../../shared/utility-model/utility-model-types'

/**
 * One backend for utility model calls. Implementations only speak their API and classify its
 * failures; fallback, pausing and status live in UtilityModelService and apply to every provider.
 */
export type UtilityModelProvider = {
  readonly id: UtilityModelProviderId
  /** The model's reply text; throws UtilityModelError. */
  complete(model: string, request: UtilityModelRequest, signal?: AbortSignal): Promise<string>
  /**
   * A decision model's answers to typed questions about a state; throws UtilityModelError. Only
   * on providers that host such models.
   */
  decide?(
    model: string,
    request: UtilityModelDecisionRequest,
    signal?: AbortSignal
  ): Promise<UtilityModelDecision>
  /** Text-generation models this account can pick from; throws UtilityModelError. */
  listModels(signal?: AbortSignal): Promise<UtilityModelCatalogEntry[]>
}

export type UtilityModelDecisionRequest = {
  /** The model's own request body: its state and its questions. */
  body: unknown
  timeoutMs?: number
}

export type UtilityModelDecision = {
  /** The model's answer per question id, as it gave them. */
  answers: unknown
  /** What the provider billed the state and questions as; null when it did not say. */
  inputTokens: number | null
}

export class UtilityModelError extends Error {
  constructor(
    readonly kind: UtilityModelFailureKind,
    message: string,
    readonly detail: {
      model?: string
      /** The day's allocation is spent: nothing succeeds before the next UTC day. */
      dailyLimit?: boolean
      /** The provider's own wait hint for a short rate limit. */
      retryAfterMs?: number
      /** When the provider says the limit lifts. */
      resetAt?: number
      /** The limit is this model's alone (an upstream host's): another model may still answer. */
      modelScoped?: boolean
    } = {}
  ) {
    super(message)
    this.name = 'UtilityModelError'
  }
}
