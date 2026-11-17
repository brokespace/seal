import { cleanGeneratedText } from '../../shared/source-control/ai/generation/commit-message-agent-output'
import type {
  UtilityModelCatalogEntry,
  UtilityModelProviderId,
  UtilityModelRequest
} from '../../shared/utility-model/utility-model-types'
import { chatCompletionsUrl } from '../home-chat/drivers/api/openai-chat-request'
import { UtilityModelError, type UtilityModelProvider } from './utility-model-provider'
import {
  clipProviderText,
  jsonRecord as record,
  jsonText as text,
  requestUtilityModelJson,
  retryAfterMs,
  utilityModelFetch,
  type UtilityModelFetch
} from './utility-model-http-request'

export type OpenAiCompatibleEndpoint = {
  id: UtilityModelProviderId
  /** The provider's name in failure text. */
  label: string
  /** The API root that `/chat/completions` hangs off. */
  baseUrl: string
  apiKey: string
  /** Provider-specific request fields, sent beside the standard ones. */
  extraBody?: Record<string, unknown>
  listModels: (signal?: AbortSignal) => Promise<UtilityModelCatalogEntry[]>
}

const UNKNOWN_MODEL =
  /not a valid model|model.{0,40}(not found|does not exist|not available|not supported)|no endpoints found|invalid model|unknown model|model_not_found/i

type ProviderError = { status: number; message: string; resetAt?: number }

/** `error` as OpenAI-shaped APIs send it: a string, or `{ message, code, metadata }`. */
function providerError(response: Response, body: unknown, label: string): ProviderError | null {
  const raw = record(body)?.error
  const error = record(raw)
  if (response.ok && (raw === undefined || raw === null)) {
    return null
  }
  const metadata = record(error?.metadata)
  // OpenRouter wraps an upstream host's own words in `metadata.raw`; they say more than "Provider returned error".
  const message =
    text(metadata?.raw) ??
    text(error?.message) ??
    text(raw) ??
    text(record(body)?.message) ??
    `${label} answered HTTP ${response.status}`
  const code = Number(error?.code)
  const reset = Number(record(metadata?.headers)?.['X-RateLimit-Reset'])
  return {
    // A 200 can still carry an error whose `code` is the status the upstream host answered with.
    status: response.ok && Number.isInteger(code) && code >= 400 ? code : response.status,
    message: clipProviderText(message),
    ...(Number.isFinite(reset) && reset > 0 ? { resetAt: reset } : {})
  }
}

function failureOf(response: Response, error: ProviderError, model?: string): UtilityModelError {
  const { status, message } = error
  const detail = model ? { model } : {}
  if (status === 429) {
    const wait = { retryAfterMs: retryAfterMs(response), resetAt: error.resetAt }
    // OpenRouter's own caps on free models cover the whole key; anything else is one upstream host's.
    if (/free-models-per-day|daily limit|quota/i.test(message)) {
      return new UtilityModelError('rate-limited', message, {
        ...detail,
        ...wait,
        dailyLimit: true
      })
    }
    return new UtilityModelError('rate-limited', message, {
      ...detail,
      ...wait,
      modelScoped: !/free-models-per-min/i.test(message)
    })
  }
  if (status === 401) {
    return new UtilityModelError('unauthorized', message, detail)
  }
  if (status === 402) {
    // Out of credits: a free model can still answer.
    return new UtilityModelError('plan-unavailable', message, detail)
  }
  if (status === 404 || (status === 400 && UNKNOWN_MODEL.test(message))) {
    return new UtilityModelError('model-not-found', message, detail)
  }
  if (status === 403 && !/moderation|flagged/i.test(message)) {
    return new UtilityModelError('unauthorized', message, detail)
  }
  // 408/5xx: the model's host is down or overloaded, which says nothing about the next model.
  return new UtilityModelError('bad-response', message, {
    ...detail,
    modelScoped: status === 408 || status >= 500
  })
}

/** `choices[0].message.content`: a string, or parts whose text is joined. */
function replyText(body: unknown): string | null {
  const choices = record(body)?.choices
  const content = record(record(Array.isArray(choices) ? choices[0] : null)?.message)?.content
  if (Array.isArray(content)) {
    return text(content.map((part) => text(record(part)?.text) ?? '').join(''))
  }
  return text(content)
}

/** Chat Completions as OpenRouter, MiniMax and other OpenAI-shaped APIs serve it: one request, no stream. */
export function createOpenAiCompatibleProvider(
  endpoint: OpenAiCompatibleEndpoint,
  fetchImpl: UtilityModelFetch = utilityModelFetch
): UtilityModelProvider {
  return {
    id: endpoint.id,
    async complete(model: string, request: UtilityModelRequest, signal?: AbortSignal) {
      const { response, body } = await requestUtilityModelJson({
        fetchImpl,
        provider: endpoint.label,
        url: chatCompletionsUrl(endpoint.baseUrl),
        init: {
          method: 'POST',
          body: JSON.stringify({
            ...endpoint.extraBody,
            model,
            messages: request.messages,
            max_tokens: request.maxTokens,
            stream: false
          })
        },
        apiKey: endpoint.apiKey,
        signal,
        model,
        timeoutMs: request.timeoutMs
      })
      const error = providerError(response, body, endpoint.label)
      if (error) {
        throw failureOf(response, error, model)
      }
      // Reasoning models may open with a think block; the answer is what follows it.
      const reply = cleanGeneratedText(replyText(body) ?? '', 'prose')
      if (!reply) {
        throw new UtilityModelError('bad-response', `${endpoint.label} answered without any text`, {
          model,
          modelScoped: true
        })
      }
      return reply
    },
    listModels: (signal) => endpoint.listModels(signal)
  }
}

/** One JSON request beside the completions: a listing or a decision, with a completion's failure classes. */
export async function requestOpenAiCompatibleJson(input: {
  label: string
  url: string
  apiKey: string | null
  /** A GET when left out. */
  body?: unknown
  model?: string
  timeoutMs?: number
  signal?: AbortSignal
  fetchImpl?: UtilityModelFetch
}): Promise<unknown> {
  const { response, body } = await requestUtilityModelJson({
    fetchImpl: input.fetchImpl ?? utilityModelFetch,
    provider: input.label,
    url: input.url,
    init:
      input.body === undefined
        ? { method: 'GET' }
        : { method: 'POST', body: JSON.stringify(input.body) },
    apiKey: input.apiKey,
    signal: input.signal,
    model: input.model,
    timeoutMs: input.timeoutMs
  })
  const error = providerError(response, body, input.label)
  if (error) {
    throw failureOf(response, error, input.model)
  }
  return body
}
