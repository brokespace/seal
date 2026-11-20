import { getMainHttpClient } from '../../../network/http-client'
import {
  OpenAiStreamAccumulator,
  type OpenAiChatMessage,
  type OpenAiStreamDelta,
  type OpenAiStreamResult
} from './openai-stream-accumulator'

export type OpenAiEndpoint = { baseUrl: string; model: string; apiKey: string | null }

const MAX_ATTEMPTS = 4
const BASE_DELAY_MS = 1_000
const MAX_DELAY_MS = 30_000
const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529])

/** The request was larger than the model's context; the caller can shrink it and try again. */
export class ContextOverflowError extends Error {}

export function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  return trimmed.endsWith('/chat/completions') ? trimmed : `${trimmed}/chat/completions`
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms)
    function done(): void {
      signal.removeEventListener('abort', aborted)
      resolve()
    }
    function aborted(): void {
      clearTimeout(timer)
      reject(signal.reason instanceof Error ? signal.reason : new Error('Stopped'))
    }
    signal.addEventListener('abort', aborted, { once: true })
  })
}

function retryDelayMs(response: Response | null, attempt: number): number {
  const header = Number(response?.headers.get('retry-after'))
  const asked = Number.isFinite(header) && header > 0 ? header * 1_000 : 0
  return Math.min(MAX_DELAY_MS, Math.max(asked, BASE_DELAY_MS * 2 ** attempt))
}

function isOverflow(status: number, detail: string): boolean {
  return (
    (status === 400 || status === 413) &&
    /context[_ ](length|window)|maximum context|too many tokens|prompt is too long|reduce the length/i.test(
      detail
    )
  )
}

/**
 * POST one Chat Completions request. Transient failures (rate limits, overload, dropped connections)
 * are retried with backoff before anything was streamed; after that a failure is the caller's.
 */
async function post(
  endpoint: OpenAiEndpoint,
  body: Record<string, unknown>,
  signal: AbortSignal
): Promise<Response> {
  if (!endpoint.baseUrl.trim() || !endpoint.model.trim()) {
    throw new Error('Set a base URL and model for the model API in the assistant settings.')
  }
  let lastError = 'no response'
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    signal.throwIfAborted()
    let response: Response | null = null
    try {
      response = await getMainHttpClient().fetch(chatCompletionsUrl(endpoint.baseUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(endpoint.apiKey ? { Authorization: `Bearer ${endpoint.apiKey}` } : {})
        },
        body: JSON.stringify({ model: endpoint.model, ...body }),
        signal
      })
    } catch (error) {
      signal.throwIfAborted()
      lastError = `could not reach ${endpoint.baseUrl}: ${error instanceof Error ? error.message : String(error)}`
    }
    if (response?.ok && response.body) {
      return response
    }
    if (response) {
      const detail = (await response.text().catch(() => '')).slice(0, 600)
      if (isOverflow(response.status, detail)) {
        throw new ContextOverflowError(detail)
      }
      lastError = `the model API answered ${response.status}${detail ? `: ${detail}` : ''}`
      if (!RETRYABLE_STATUS.has(response.status)) {
        break
      }
    }
    if (attempt < MAX_ATTEMPTS - 1) {
      await sleep(retryDelayMs(response, attempt), signal)
    }
  }
  throw new Error(`The model request failed: ${lastError}`)
}

export async function streamChatCompletion(
  endpoint: OpenAiEndpoint,
  request: { messages: OpenAiChatMessage[]; tools?: unknown[] },
  signal: AbortSignal,
  onDelta: (delta: OpenAiStreamDelta) => void
): Promise<OpenAiStreamResult> {
  const response = await post(
    endpoint,
    {
      messages: request.messages,
      ...(request.tools?.length ? { tools: request.tools } : {}),
      stream: true,
      stream_options: { include_usage: true }
    },
    signal
  )
  const acc = new OpenAiStreamAccumulator()
  const decoder = new TextDecoder()
  const reader = response.body!.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      acc.feed(decoder.decode(value, { stream: true })).forEach(onDelta)
    }
  } finally {
    // An unread body can crash the process (see http-client).
    await reader.cancel().catch(() => {})
  }
  return acc.result()
}
