import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import type { UtilityModelChoice } from '../../shared/utility-model/utility-model-selection'
import { SessionSummarizer } from '../session-summaries/session-summarizer'
import { SessionSummaryCache } from '../session-summaries/session-summary-cache'
import {
  OPENROUTER_API_KEY_ENV,
  createOpenRouterProvider,
  listOpenRouterModels
} from './openrouter-utility-provider'
import { UtilityModelHost } from './utility-model-host'
import type { UtilityModelFetch } from './utility-model-http-request'

const API_KEY = 'sk-or-v1-0123456789abcdef0123456789abcdef'
const AGENT_MESSAGE = [
  'I finished the database migration and updated the three callers that still read the old column.',
  'The integration suite passes locally. Before I delete the old column I need you to confirm',
  'that the reporting job has been switched over, because it is outside this repository.'
].join(' ')

// The app's client is Electron's; a test talks to the network with Node's.
const nodeFetch: UtilityModelFetch = (url, init) => fetch(url, init)

type SeenRequest = { path: string; authorization: string | undefined; body: unknown }

async function readJson(request: IncomingMessage): Promise<unknown> {
  request.setEncoding('utf8')
  let text = ''
  for await (const chunk of request) {
    text += String(chunk)
  }
  return text ? JSON.parse(text) : null
}

/** An OpenAI-compatible server: `answer` decides each chat completion by the model asked for. */
async function openAiCompatibleServer(
  answer: (model: string) => { status: number; body: unknown }
): Promise<{ baseUrl: string; seen: SeenRequest[]; server: Server }> {
  const seen: SeenRequest[] = []
  const server = createServer((request, response) => {
    void readJson(request).then((body) => {
      seen.push({ path: request.url ?? '', authorization: request.headers.authorization, body })
      const model =
        typeof body === 'object' && body !== null && 'model' in body ? String(body.model) : ''
      const reply = answer(model)
      response.writeHead(reply.status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(reply.body))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { baseUrl: `http://127.0.0.1:${port}/api/v1`, seen, server }
}

/** The summary a session card ends up showing when summaries run on OpenRouter with `choice`. */
async function summarizeThroughOpenRouter(
  choice: UtilityModelChoice,
  options: { apiKey: string; baseUrl?: string }
): Promise<string | null> {
  const provider = createOpenRouterProvider(options.apiKey, {
    fetchImpl: nodeFetch,
    baseUrl: options.baseUrl
  })
  const host = new UtilityModelHost({
    sources: {
      openrouter: async () => ({
        configured: true,
        source: 'settings',
        accountHint: options.apiKey.slice(-4),
        tokenProtection: 'sealed',
        defaultModels: [],
        provider
      })
    }
  })
  const client = host.client(() => choice)
  return await new Promise<string | null>((resolve) => {
    const summarizer: SessionSummarizer = new SessionSummarizer({
      complete: async (request, signal) => (await client.complete(request, signal)).text,
      enabled: () => true,
      cache: new SessionSummaryCache(null),
      debounceMs: 0,
      onChange: (sessionKey) => {
        const view = summarizer.view(sessionKey)
        if (view && !view.pending) {
          resolve(view.text)
        }
      }
    })
    summarizer.request('session-1', AGENT_MESSAGE, true)
  })
}

describe('session summaries on OpenRouter, over HTTP', () => {
  let server: Server | null = null
  afterEach(() => {
    server?.close()
    server = null
  })

  it('summarizes with the fallback model when the chosen one is rate limited upstream', async () => {
    const mock = await openAiCompatibleServer((model) =>
      model === 'busy/model:free'
        ? {
            status: 429,
            body: {
              error: {
                code: 429,
                message: 'Provider returned error',
                metadata: { raw: 'busy/model:free is temporarily rate-limited upstream.' }
              }
            }
          }
        : {
            status: 200,
            body: {
              choices: [
                {
                  message: {
                    role: 'assistant',
                    content: '**Needs you to confirm the reporting job.**'
                  }
                }
              ]
            }
          }
    )
    server = mock.server

    const summary = await summarizeThroughOpenRouter(
      { provider: 'openrouter', model: 'busy/model:free', fallbackModel: 'calm/model:free' },
      { apiKey: API_KEY, baseUrl: mock.baseUrl }
    )

    expect(summary).toBe('Needs you to confirm the reporting job.')
    expect(mock.seen.map((request) => request.path)).toEqual([
      '/api/v1/chat/completions',
      '/api/v1/chat/completions'
    ])
    expect(mock.seen.map((request) => request.authorization)).toEqual([
      `Bearer ${API_KEY}`,
      `Bearer ${API_KEY}`
    ])
    expect(mock.seen.map((request) => request.body)).toMatchObject([
      { model: 'busy/model:free', stream: false, max_tokens: 48 },
      { model: 'calm/model:free', stream: false, max_tokens: 48 }
    ])
  })

  it('shows no summary when the key is rejected, and asks only once', async () => {
    const mock = await openAiCompatibleServer(() => ({
      status: 401,
      body: { error: { code: 401, message: 'No auth credentials found' } }
    }))
    server = mock.server

    const summary = await summarizeThroughOpenRouter(
      { provider: 'openrouter', model: 'busy/model:free', fallbackModel: 'calm/model:free' },
      { apiKey: API_KEY, baseUrl: mock.baseUrl }
    )

    expect(summary).toBeNull()
    expect(mock.seen).toHaveLength(1)
  })
})

// Against openrouter.ai itself: `SEAL_OPENROUTER_LIVE=1 pnpm test <this file>`; a completion also needs OPENROUTER_API_KEY.
describe.runIf(process.env.SEAL_OPENROUTER_LIVE === '1')('OpenRouter, live', () => {
  const liveKey = process.env[OPENROUTER_API_KEY_ENV]?.trim()

  it('lists models from the public endpoint and flags the free ones', async () => {
    const models = await listOpenRouterModels({ fetchImpl: nodeFetch })

    expect(models.length).toBeGreaterThan(50)
    const free = models.filter((model) => model.free)
    expect(free.length).toBeGreaterThan(0)
    expect(free.some((model) => model.id.endsWith(':free'))).toBe(true)
    expect(models.some((model) => !model.free)).toBe(true)
  })

  it.runIf(liveKey)(
    'summarizes a session with a free model',
    async () => {
      const summary = await summarizeThroughOpenRouter(
        { provider: 'openrouter', model: 'openrouter/free', fallbackModel: null },
        { apiKey: liveKey ?? '' }
      )

      expect(summary).toEqual(expect.any(String))
      expect(summary?.length).toBeGreaterThan(0)
    },
    90_000
  )
})
