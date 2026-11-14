import type {
  UtilityModelCatalogEntry,
  UtilityModelRequest
} from '../../shared/utility-model/utility-model-types'
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

export type CloudflareAiCredentials = { accountId: string; apiToken: string }

const API_ROOT = 'https://api.cloudflare.com/client/v4/accounts'

/** Cloudflare's `errors[].message`, joined; the body never echoes the request's token. */
function errorText(body: unknown, status: number): string {
  const errors = record(body)?.errors
  const messages = (Array.isArray(errors) ? errors : [])
    .map((entry) => text(record(entry)?.message))
    .filter((message): message is string => message !== null)
  return clipProviderText(messages.join('; ') || `Cloudflare answered HTTP ${status}`)
}

function failureOf(response: Response, body: unknown, model?: string): UtilityModelError {
  const message = errorText(body, response.status)
  const detail = model ? { model } : {}
  if (response.status === 429) {
    return new UtilityModelError('rate-limited', message, {
      ...detail,
      dailyLimit: /daily|neurons|allocation/i.test(message),
      retryAfterMs: retryAfterMs(response)
    })
  }
  if (response.status === 401) {
    return new UtilityModelError('unauthorized', message, detail)
  }
  if (response.status === 403) {
    // A token without Workers AI access is also a 403; only the plan wording means "try another model".
    return new UtilityModelError(
      /\bplan\b/i.test(message) ? 'plan-unavailable' : 'unauthorized',
      message,
      detail
    )
  }
  if (response.status === 404 || /no such model|model not found/i.test(message)) {
    return new UtilityModelError('model-not-found', message, detail)
  }
  return new UtilityModelError('bad-response', message, detail)
}

/** `result.response`, else the OpenAI-shaped `result.choices[0].message.content` newer models answer with. */
function replyText(body: unknown): string | null {
  const result = record(record(body)?.result)
  const choices = result?.choices
  const first = Array.isArray(choices) ? record(choices[0]) : null
  return text(result?.response) ?? text(record(first?.message)?.content)
}

export function createCloudflareWorkersAiProvider(
  credentials: CloudflareAiCredentials,
  fetchImpl: UtilityModelFetch = utilityModelFetch
): UtilityModelProvider {
  const base = `${API_ROOT}/${encodeURIComponent(credentials.accountId)}/ai`

  const call = async (
    path: string,
    init: RequestInit,
    signal: AbortSignal | undefined,
    model?: string,
    timeoutMs?: number
  ): Promise<unknown> => {
    const { response, body } = await requestUtilityModelJson({
      fetchImpl,
      provider: 'Cloudflare',
      url: `${base}${path}`,
      init,
      apiKey: credentials.apiToken,
      signal,
      model,
      timeoutMs
    })
    if (!response.ok || record(body)?.success === false) {
      throw failureOf(response, body, model)
    }
    return body
  }

  return {
    id: 'cloudflare-workers-ai',
    async complete(model: string, request: UtilityModelRequest, signal?: AbortSignal) {
      // Model ids are `@cf/<org>/<name>`: their slashes are path segments, not data to escape.
      const body = await call(
        `/run/${model}`,
        {
          method: 'POST',
          body: JSON.stringify({
            messages: request.messages,
            max_tokens: request.maxTokens,
            // Reasoning models otherwise spend the whole budget thinking and answer nothing.
            chat_template_kwargs: { enable_thinking: false }
          })
        },
        signal,
        model,
        request.timeoutMs
      )
      const reply = replyText(body)
      if (reply === null) {
        throw new UtilityModelError('bad-response', 'Cloudflare answered without any text', {
          model
        })
      }
      return reply
    },
    async listModels(signal?: AbortSignal) {
      const body = await call(
        '/models/search?task=Text%20Generation&per_page=100',
        { method: 'GET' },
        signal
      )
      const result = record(body)?.result
      const models = (Array.isArray(result) ? result : []).flatMap(
        (entry): UtilityModelCatalogEntry[] => {
          const id = text(record(entry)?.name)
          return id ? [{ id, description: text(record(entry)?.description) }] : []
        }
      )
      return models.sort((a, b) => a.id.localeCompare(b.id))
    }
  }
}
