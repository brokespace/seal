// The Workers AI endpoint a scenario's recap talks to: recorded replies, failures on request, or the real API.
import { createHash } from 'node:crypto'
import type { UtilityModelMessage } from '../../../shared/utility-model/utility-model-types'
import {
  CLOUDFLARE_AI_DEFAULT_FALLBACK_MODEL,
  CLOUDFLARE_AI_DEFAULT_MODEL
} from '../../../shared/utility-model/utility-model-types'
import type { UtilityModelFetch } from '../../utility-model/utility-model-http-request'

export const RECAP_SCENARIO_MODELS = {
  primary: CLOUDFLARE_AI_DEFAULT_MODEL,
  fallback: CLOUDFLARE_AI_DEFAULT_FALLBACK_MODEL
} as const

/** One reply a real model gave to one request, kept so the suite runs without the network. */
export type RecapCassetteEntry = {
  key: string
  model: string
  /** The request after its system message, which every recap request shares. */
  messages: UtilityModelMessage[]
  reply: string
  /** What Workers AI billed for it, when the reply was recorded with its usage. */
  neurons?: number
}

/** A request no recording answers, for whoever can reach the model to answer. */
export type RecapPendingRequest = Omit<RecapCassetteEntry, 'reply' | 'neurons'> & {
  scenario: string
  maxTokens: number
  /** sha256 of `JSON.stringify(messages)`: what a relayed reply is checked against. */
  contentHash: string
}

export type RecapScenarioFault =
  | 'timeout'
  | 'http-500'
  | 'rate-limit'
  | 'model-not-found'
  | 'not-json'
  | 'no-text'

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

export function recapRequestKey(model: string, messages: readonly UtilityModelMessage[]): string {
  return sha256(`${model}\n${JSON.stringify(messages)}`).slice(0, 32)
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

const failed = (status: number, message: string): Response =>
  json(status, { success: false, errors: [{ code: status, message }], result: null })

/** The body Workers AI answers a chat model's run with. */
const answered = (model: string, reply: string): Response =>
  json(200, {
    success: true,
    errors: [],
    result: { model, choices: [{ index: 0, message: { role: 'assistant', content: reply } }] }
  })

function faultResponse(fault: RecapScenarioFault, model: string): Response {
  switch (fault) {
    case 'timeout':
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    case 'http-500':
      return failed(500, 'Internal server error')
    case 'rate-limit':
      return failed(429, 'Rate limited')
    case 'model-not-found':
      return failed(404, 'No such model')
    case 'not-json':
      return answered(
        model,
        'Sure. The user asked for a few things and the agent did most of them.'
      )
    case 'no-text':
      return json(200, { success: true, errors: [], result: {} })
  }
}

function requestOf(
  url: string,
  init: RequestInit
): { model: string; messages: UtilityModelMessage[]; maxTokens: number } {
  const model = decodeURIComponent(url.slice(url.indexOf('/ai/run/') + '/ai/run/'.length))
  const body: { messages: UtilityModelMessage[]; max_tokens: number } = JSON.parse(
    String(init.body)
  )
  return { model, messages: body.messages, maxTokens: body.max_tokens }
}

export type RecapScenarioModelOptions = {
  scenario: string
  cassette: ReadonlyMap<string, RecapCassetteEntry>
  /** The real endpoint, for recording; absent, a request without a recording is left pending. */
  live?: UtilityModelFetch
  onRecorded?: (entry: RecapCassetteEntry) => void
}

export class RecapScenarioModel {
  /** Requests nothing could answer; the scenario cannot go on past the first. */
  readonly pending: RecapPendingRequest[] = []
  /** Live requests the real endpoint did not answer: the run then shows the outage, not the recap. */
  readonly liveFailures: string[] = []
  /** The model of each request that got a reply, in order. */
  readonly answeredBy: string[] = []
  private readonly faults: { fault: RecapScenarioFault; model: string }[] = []

  constructor(private readonly options: RecapScenarioModelOptions) {}

  fail(fault: RecapScenarioFault, model: string, times: number): void {
    for (let count = 0; count < times; count++) {
      this.faults.push({ fault, model })
    }
  }

  readonly fetch: UtilityModelFetch = async (url, init) => {
    const { model, messages, maxTokens } = requestOf(url, init)
    const fault = this.faults.findIndex((queued) => queued.model === model)
    if (fault !== -1) {
      return faultResponse(this.faults.splice(fault, 1)[0].fault, model)
    }
    const key = recapRequestKey(model, messages)
    const recorded = this.options.cassette.get(key)
    if (recorded) {
      this.answeredBy.push(model)
      return answered(model, recorded.reply)
    }
    const rest = messages.slice(1)
    if (!this.options.live) {
      // Only the first is the scenario's own: what follows it is the pipeline reacting to no reply.
      if (this.pending.length > 0) {
        throw new Error(`No recorded reply for a ${model} request of ${this.options.scenario}`)
      }
      this.pending.push({
        scenario: this.options.scenario,
        key,
        model,
        messages: rest,
        maxTokens,
        contentHash: sha256(JSON.stringify(rest))
      })
      throw new Error(`No recorded reply for a ${model} request of ${this.options.scenario}`)
    }
    const response = await this.options.live(url, init).catch((error: unknown) => {
      this.liveFailures.push(`${model} unreachable`)
      throw error
    })
    const body: unknown = await response.json().catch(() => null)
    const reply = replyOf(body)
    if (response.ok && reply !== null) {
      this.answeredBy.push(model)
      this.options.onRecorded?.({ key, model, messages: rest, reply, ...neuronsOf(body) })
    } else {
      this.liveFailures.push(`${model} http-${response.status}`)
    }
    return json(response.status, body)
  }
}

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null && key in value
    ? Object.getOwnPropertyDescriptor(value, key)?.value
    : undefined
}

function replyOf(body: unknown): string | null {
  const result = field(body, 'result')
  const choices = field(result, 'choices')
  const content = field(field(Array.isArray(choices) ? choices[0] : null, 'message'), 'content')
  const text = field(result, 'response') ?? content
  return typeof text === 'string' && text.trim() ? text : null
}

function neuronsOf(body: unknown): { neurons?: number } {
  const neurons = field(field(field(body, 'result'), 'usage'), 'neurons')
  return typeof neurons === 'number' ? { neurons } : {}
}
