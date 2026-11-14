import {
  MCP_PARSE_ERROR,
  MCP_PROTOCOL_VERSIONS,
  mcpError,
  parseMcpBody,
  type McpJsonRpcMessage
} from '../protocol/mcp-json-rpc-server'
import type { SealMcpPeer } from '../seal-mcp-admission'
import type { SealMcpService } from '../seal-mcp-service'

export const SEAL_MCP_HTTP_PATH = '/mcp'
export const SEAL_MCP_MAX_BODY_BYTES = 4 * 1024 * 1024
const KEEPALIVE_MS = 15_000

export type SealMcpHttpStream = { write: (chunk: string) => void; end: () => void }

/**
 * One HTTP request to the MCP endpoint, however it arrived: on this server's own port, or
 * forwarded by the relay. Header names are lower case.
 */
export type SealMcpHttpExchange = {
  method: string
  headers: Readonly<Record<string, string | undefined>>
  /** The request body, or null when it is larger than SEAL_MCP_MAX_BODY_BYTES. */
  readBody: () => Promise<string | null>
  peer: SealMcpPeer
  /** Aborts when the caller goes away, so a tool call it no longer waits for stops. */
  signal: AbortSignal
  respond: (status: number, headers: Record<string, string>, body?: string) => void
  openStream: (status: number, headers: Record<string, string>) => SealMcpHttpStream
  /** How often an open event stream is written to; a dead caller is only noticed on a write. */
  keepAliveMs?: number
}

const JSON_HEADERS = { 'content-type': 'application/json' }

function bearerToken(authorization: string | undefined): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization ?? '')
  return match ? match[1] : null
}

/** A browser page on another origin must not drive this server, even with a token it was given. */
function crossOrigin(headers: SealMcpHttpExchange['headers']): boolean {
  const { origin, host } = headers
  if (!origin) {
    return false
  }
  try {
    return new URL(origin).host !== host
  } catch {
    return true
  }
}

function wantsEventStream(headers: SealMcpHttpExchange['headers']): boolean {
  return (headers.accept ?? '').includes('text/event-stream')
}

/**
 * MCP's Streamable HTTP transport, stateless: every POST carries its own token and gets its own
 * answer. Tool calls answer as an event stream so a call waiting on approval keeps the connection
 * alive; there is no server-initiated stream, so GET is declined.
 */
export async function answerSealMcpHttp(
  service: SealMcpService,
  exchange: SealMcpHttpExchange
): Promise<void> {
  const { headers, respond } = exchange
  if (crossOrigin(headers)) {
    respond(403, JSON_HEADERS, JSON.stringify({ error: 'cross-origin requests are not allowed' }))
    return
  }
  const admission = service.admit(bearerToken(headers.authorization), exchange.peer)
  if (!admission.ok) {
    switch (admission.reason) {
      case 'disabled':
        respond(404, {})
        return
      case 'throttled':
        respond(429, { 'retry-after': String(admission.retryAfterSeconds) })
        return
      case 'unauthorized':
        respond(
          401,
          { ...JSON_HEADERS, 'www-authenticate': 'Bearer realm="seal-mcp"' },
          JSON.stringify({ error: 'a valid Seal MCP client token is required' })
        )
        return
    }
  }
  if (exchange.method !== 'POST') {
    respond(405, { allow: 'POST' })
    return
  }
  const version = headers['mcp-protocol-version']
  if (version && !MCP_PROTOCOL_VERSIONS.includes(version)) {
    respond(400, JSON_HEADERS, JSON.stringify({ error: `unsupported MCP-Protocol-Version` }))
    return
  }
  if (!(headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
    respond(415, {})
    return
  }
  const body = await exchange.readBody()
  if (body === null) {
    respond(413, {})
    return
  }
  const parsed = parseMcpBody(body)
  if (!parsed) {
    respond(400, JSON_HEADERS, JSON.stringify(mcpError(null, MCP_PARSE_ERROR, 'Parse error')))
    return
  }
  const { client } = admission
  const answer = (message: McpJsonRpcMessage): Promise<McpJsonRpcMessage | null> =>
    service.handle(client, exchange.peer, message, exchange.signal)
  const slow = parsed.messages.some((message) => message.method === 'tools/call')
  if (!slow || !wantsEventStream(headers)) {
    const replies = (await Promise.all(parsed.messages.map(answer))).filter(
      (reply) => reply !== null
    )
    if (replies.length === 0) {
      respond(202, {})
      return
    }
    respond(200, JSON_HEADERS, JSON.stringify(parsed.batch ? replies : replies[0]))
    return
  }
  const stream = exchange.openStream(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform'
  })
  const keepalive = setInterval(
    () => stream.write(': keepalive\n\n'),
    exchange.keepAliveMs ?? KEEPALIVE_MS
  )
  try {
    await Promise.all(
      parsed.messages.map(async (message) => {
        const reply = await answer(message)
        if (reply) {
          stream.write(`event: message\ndata: ${JSON.stringify(reply)}\n\n`)
        }
      })
    )
  } finally {
    clearInterval(keepalive)
    stream.end()
  }
}
