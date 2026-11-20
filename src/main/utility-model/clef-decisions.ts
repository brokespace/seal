// Clef, Cloudflare's decision models, on whichever account this host has for them. Every judge asks
// through here, so none carries its own provider order, model ids or request shape.
import type { UtilityModelProviderId } from '../../shared/utility-model/utility-model-types'
import { jsonRecord } from './utility-model-http-request'
import {
  UtilityModelError,
  type UtilityModelDecision,
  type UtilityModelDecisionRequest
} from './utility-model-provider'
import type { UtilityModelService } from './utility-model-service'

export const CLEF_MODELS = ['clef', 'clef-flash'] as const
export type ClefModel = (typeof CLEF_MODELS)[number]

/** Preferred first: OpenRouter bills by the token, Workers AI stops at the account's daily allocation. */
export const CLEF_PROVIDER_IDS = [
  'openrouter',
  'cloudflare-workers-ai'
] as const satisfies readonly UtilityModelProviderId[]
export type ClefProviderId = (typeof CLEF_PROVIDER_IDS)[number]

type ClefRoute = {
  id: (model: ClefModel) => string
  /** The provider's request around what was asked: `state` and the typed `questions`. */
  body: (model: ClefModel, asked: Record<string, unknown>) => unknown
}

const ROUTES: Record<ClefProviderId, ClefRoute> = {
  openrouter: {
    id: (model) => `cloudflare/${model}`,
    body: (model, asked) => ({
      ...asked,
      model: `cloudflare/${model}`,
      // OpenRouter also routes Clef to quantized copies on other hosts, whose probabilities no
      // threshold was measured on: only Cloudflare's own host answers, as on Workers AI.
      provider: { only: ['cloudflare'] }
    })
  },
  'cloudflare-workers-ai': {
    id: (model) => `@cf/cloudflare/${model}`,
    body: (model, asked) => ({ ...asked, model })
  }
}

/** A Clef model by its name or by either provider's id for it; null for any other model. */
export function clefModelNamed(id: string): ClefModel | null {
  return (
    CLEF_MODELS.find(
      (model) =>
        id === model || CLEF_PROVIDER_IDS.some((provider) => ROUTES[provider].id(model) === id)
    ) ?? null
  )
}

export type ClefDecision = UtilityModelDecision & {
  /** The account that answered, for whoever keeps a tally per provider. */
  provider: ClefProviderId
}

export type ClefDecisions = {
  /**
   * Asks one Clef model, named as `clefModelNamed` reads it. `request.body` holds `state` and
   * `questions`. The first provider with an account is asked, and the next when that one fails:
   * the model is the same on both, so its thresholds hold. Throws UtilityModelError.
   */
  decide(
    model: string,
    request: UtilityModelDecisionRequest,
    signal?: AbortSignal,
    /** `providers` narrows who may be asked, in the order given: a caller's own budget, say. */
    options?: { providers?: readonly ClefProviderId[] }
  ): Promise<ClefDecision>
}

export function createClefDecisions(
  service: (provider: ClefProviderId) => Pick<UtilityModelService, 'decide'>
): ClefDecisions {
  return {
    async decide(named, request, signal, options = {}) {
      const model = clefModelNamed(named)
      if (model === null) {
        throw new UtilityModelError('model-not-found', 'Not a Clef model', { model: named })
      }
      const asked = jsonRecord(request.body) ?? {}
      let failure: UtilityModelError | null = null
      for (const provider of options.providers ?? CLEF_PROVIDER_IDS) {
        const route = ROUTES[provider]
        try {
          const decision = await service(provider).decide(
            route.id(model),
            { ...request, body: route.body(model, asked) },
            signal
          )
          return { ...decision, provider }
        } catch (error) {
          if (!(error instanceof UtilityModelError) || signal?.aborted) {
            throw error
          }
          // An account that is not there did not fail: the one that was asked says why.
          if (error.kind !== 'not-configured') {
            failure = error
          }
        }
      }
      throw (
        failure ??
        new UtilityModelError('not-configured', 'No account on this host runs Clef', {
          model: named
        })
      )
    }
  }
}
