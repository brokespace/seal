import { isRecord } from '../home-chat/home-chat-record-guard'
import { getMainHttpClient } from '../network/http-client'
import { UtilityModelError } from './utility-model-provider'

export type UtilityModelFetch = (input: string, init: RequestInit) => Promise<Response>

const REQUEST_TIMEOUT_MS = 20_000
const MAX_ERROR_TEXT = 300

/** The app's client carries the desktop's proxy settings. */
export const utilityModelFetch: UtilityModelFetch = (url, init) =>
  getMainHttpClient().fetch(url, init)

export function jsonRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null
}

export function jsonText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function clipProviderText(message: string): string {
  return message.length > MAX_ERROR_TEXT ? `${message.slice(0, MAX_ERROR_TEXT - 1)}…` : message
}

export function retryAfterMs(response: Response): number | undefined {
  const seconds = Number(response.headers.get('retry-after'))
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined
}

/** One JSON request to a model provider: a deadline, a body that is always read, and no URL or key in a failure. */
export async function requestUtilityModelJson(input: {
  fetchImpl: UtilityModelFetch
  /** The provider's name in failure text. */
  provider: string
  url: string
  init: RequestInit
  apiKey: string | null
  signal?: AbortSignal
  model?: string
  timeoutMs?: number
}): Promise<{ response: Response; body: unknown }> {
  const timeout = AbortSignal.timeout(input.timeoutMs ?? REQUEST_TIMEOUT_MS)
  let response: Response
  try {
    response = await input.fetchImpl(input.url, {
      ...input.init,
      headers: {
        ...(input.apiKey ? { authorization: `Bearer ${input.apiKey}` } : {}),
        'content-type': 'application/json'
      },
      signal: input.signal ? AbortSignal.any([input.signal, timeout]) : timeout
    })
  } catch (error) {
    if (input.signal?.aborted) {
      throw error
    }
    // The cause can carry the request URL; only its class of failure is reported.
    throw new UtilityModelError(
      'network',
      timeout.aborted
        ? `${input.provider} did not answer in time`
        : `Could not reach ${input.provider}`,
      input.model ? { model: input.model } : {}
    )
  }
  // Always read the body: an unread one can crash the process (see http-client).
  const body: unknown = await response
    .text()
    .then((raw): unknown => JSON.parse(raw))
    .catch(() => null)
  return { response, body }
}
