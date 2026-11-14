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
  /** Text-generation models this account can pick from; throws UtilityModelError. */
  listModels(signal?: AbortSignal): Promise<UtilityModelCatalogEntry[]>
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
    } = {}
  ) {
    super(message)
    this.name = 'UtilityModelError'
  }
}
