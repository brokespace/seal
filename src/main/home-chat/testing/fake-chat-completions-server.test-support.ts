import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

export type FakeChatMessage = {
  role: string
  content: string | null
  tool_calls?: { id: string; function: { name: string; arguments: string } }[]
  tool_call_id?: string
}

export type FakeChatRequest = { messages: FakeChatMessage[]; tools?: unknown[] }

export type FakeChatReply = {
  text?: string
  toolCalls?: { id: string; name: string; args: Record<string, unknown> }[]
  finishReason?: string
  usage?: { prompt_tokens: number; completion_tokens: number }
}

export type FakeChatCompletionsServer = {
  baseUrl: string
  requests: FakeChatRequest[]
  close: () => Promise<void>
}

function sse(reply: FakeChatReply): string {
  const events: unknown[] = []
  // Split the text so consumers have to assemble deltas.
  const text = reply.text ?? ''
  const middle = Math.ceil(text.length / 2)
  for (const part of [text.slice(0, middle), text.slice(middle)].filter(Boolean)) {
    events.push({ choices: [{ delta: { content: part } }] })
  }
  ;(reply.toolCalls ?? []).forEach((call, index) => {
    events.push({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index,
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: JSON.stringify(call.args) }
              }
            ]
          }
        }
      ]
    })
  })
  events.push({
    choices: [
      { delta: {}, finish_reason: reply.finishReason ?? (reply.toolCalls ? 'tool_calls' : 'stop') }
    ]
  })
  if (reply.usage) {
    events.push({ choices: [], usage: reply.usage })
  }
  return `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`
}

/** A Chat Completions endpoint that answers from a script and records what it was sent. */
export async function startFakeChatCompletionsServer(
  respond: (request: FakeChatRequest, index: number) => FakeChatReply
): Promise<FakeChatCompletionsServer> {
  const requests: FakeChatRequest[] = []
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the driver under test sends this shape.
      const request = JSON.parse(Buffer.concat(chunks).toString('utf8')) as FakeChatRequest
      requests.push(request)
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.end(sse(respond(request, requests.length - 1)))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a TCP listener's address is an AddressInfo.
  const { port } = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      })
  }
}
