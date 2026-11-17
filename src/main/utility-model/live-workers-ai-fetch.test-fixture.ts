// A Workers AI run request, answered by the account of a live run. With an OpenRouter account the
// same model is asked through the app's own provider and the answer handed back in Workers AI's
// shape, so a recording made on either account is filed and replayed the same way.
import {
  CLOUDFLARE_AI_DEFAULT_FALLBACK_MODEL,
  CLOUDFLARE_AI_DEFAULT_MODEL,
  type UtilityModelFailureKind,
  type UtilityModelMessage
} from '../../shared/utility-model/utility-model-types'
import { clefModelNamed } from './clef-decisions'
import {
  liveClefDecisions,
  liveModelFetch,
  liveModelProvider,
  type LiveModelAccount
} from './live-model-account.test-fixture'
import type { UtilityModelFetch } from './utility-model-http-request'
import { UtilityModelError } from './utility-model-provider'

/** The chat models the recap runs on by default, under OpenRouter's ids for them. */
const OPENROUTER_CHAT_MODELS: Record<string, string> = {
  [CLOUDFLARE_AI_DEFAULT_MODEL]: 'z-ai/glm-4.7-flash',
  [CLOUDFLARE_AI_DEFAULT_FALLBACK_MODEL]: 'google/gemma-4-26b-a4b-it'
}

/** The status Workers AI gives the same failure, which is what a caller of this endpoint reads. */
const STATUS: Record<UtilityModelFailureKind, number> = {
  'rate-limited': 429,
  unauthorized: 401,
  'not-configured': 401,
  'plan-unavailable': 403,
  'model-not-found': 404,
  network: 504,
  'bad-response': 502
}

// A recap's reply is long, and the caller's own signal still ends the request sooner.
const REQUEST_TIMEOUT_MS = 120_000
const RUN_PATH = '/ai/run/'

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const answered = (result: unknown): Response => json(200, { success: true, errors: [], result })

const failed = (status: number, message: string): Response =>
  json(status, { success: false, errors: [{ code: status, message }], result: null })

export function liveWorkersAiFetch(account: LiveModelAccount): UtilityModelFetch {
  if (account.provider === 'cloudflare-workers-ai') {
    return liveModelFetch
  }
  const provider = liveModelProvider(account)
  const clef = liveClefDecisions(account)
  return async (url, init) => {
    const model = decodeURIComponent(url.slice(url.indexOf(RUN_PATH) + RUN_PATH.length))
    const body: { messages?: UtilityModelMessage[]; max_tokens?: number } = JSON.parse(
      String(init.body)
    )
    const signal = init.signal ?? undefined
    try {
      if (clefModelNamed(model)) {
        const { answers, inputTokens } = await clef.decide(
          model,
          { body, timeoutMs: REQUEST_TIMEOUT_MS },
          signal
        )
        return answered({
          answers,
          usage: inputTokens === null ? {} : { input_tokens: inputTokens }
        })
      }
      const named = OPENROUTER_CHAT_MODELS[model]
      if (!named || !body.messages) {
        return failed(404, 'No such model on OpenRouter for this live run')
      }
      const reply = await provider.complete(
        named,
        {
          messages: body.messages,
          maxTokens: body.max_tokens ?? 1024,
          timeoutMs: REQUEST_TIMEOUT_MS
        },
        signal
      )
      return answered({ choices: [{ index: 0, message: { role: 'assistant', content: reply } }] })
    } catch (error) {
      if (!(error instanceof UtilityModelError) || signal?.aborted) {
        throw error
      }
      // A refused request is not asked again; a host that failed or was busy is.
      const refused = error.kind === 'bad-response' && error.detail.modelScoped !== true
      return failed(refused ? 400 : STATUS[error.kind], error.message)
    }
  }
}
