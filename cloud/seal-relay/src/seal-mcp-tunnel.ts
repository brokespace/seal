import { DurableObject } from 'cloudflare:workers'
import {
  parseSealMcpHostToRelayFrame,
  SEAL_MCP_RELAY_HOST_PATH,
  SEAL_MCP_RELAY_MAX_BODY_BYTES,
  SEAL_MCP_RELAY_PING,
  SEAL_MCP_RELAY_PONG,
  SEAL_MCP_RELAY_REQUEST_HEADERS,
  SEAL_MCP_RELAY_RESPONSE_HEADERS,
  type SealMcpRelayToHostFrame
} from '../../../src/shared/seal-mcp/seal-mcp-relay-frames'
import type { SealEnv } from './env'

const HOST_TAG = 'host'
/** A host answers the head at once unless a JSON-mode call waits on a person's approval. */
const HEAD_TIMEOUT_MS = 180_000
const MAX_IN_FLIGHT = 32
const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([204, 205, 304])

type Pending = {
  head: (response: Response) => void
  body: ReadableStreamDefaultController<Uint8Array> | null
}

function plain(status: number, error: string, headers: Record<string, string> = {}): Response {
  return Response.json({ error }, { status, headers })
}

async function readCappedBody(request: Request): Promise<string | null> {
  if (Number(request.headers.get('content-length') ?? '0') > SEAL_MCP_RELAY_MAX_BODY_BYTES) {
    return null
  }
  const bytes = await request.arrayBuffer()
  return bytes.byteLength > SEAL_MCP_RELAY_MAX_BODY_BYTES ? null : new TextDecoder().decode(bytes)
}

/**
 * One object per host. It holds the host's outbound WebSocket and passes each public MCP request
 * down it, byte for byte. It keeps no tokens, stores nothing and decides nothing: the host
 * authenticates and authorizes every request itself.
 */
export class SealMcpTunnel extends DurableObject<SealEnv> {
  private readonly pending = new Map<string, Pending>()

  constructor(ctx: DurableObjectState, env: SealEnv) {
    super(ctx, env)
    // Keepalives are answered without waking the object.
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(SEAL_MCP_RELAY_PING, SEAL_MCP_RELAY_PONG)
    )
  }

  async fetch(request: Request): Promise<Response> {
    return new URL(request.url).pathname === SEAL_MCP_RELAY_HOST_PATH
      ? this.acceptHost(request)
      : this.forward(request)
  }

  /** The Worker verified the host session before routing here by the host's fingerprint. */
  private acceptHost(request: Request): Response {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return plain(426, 'websocket_required')
    }
    // The newest connection wins: a host that reconnects must not be shadowed by its dead socket.
    for (const stale of this.ctx.getWebSockets(HOST_TAG)) {
      stale.close(4000, 'replaced')
    }
    this.failAll()
    const pair = new WebSocketPair()
    this.ctx.acceptWebSocket(pair[1], [HOST_TAG])
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  private async forward(request: Request): Promise<Response> {
    const host = this.ctx.getWebSockets(HOST_TAG)[0]
    if (!host) {
      return plain(503, 'host_offline', { 'retry-after': '10' })
    }
    if (this.pending.size >= MAX_IN_FLIGHT) {
      return plain(429, 'too_many_requests', { 'retry-after': '5' })
    }
    const body = await readCappedBody(request)
    if (body === null) {
      return plain(413, 'body_too_large')
    }
    const headers: Record<string, string> = { host: new URL(request.url).host }
    for (const name of SEAL_MCP_RELAY_REQUEST_HEADERS) {
      const value = request.headers.get(name)
      if (value !== null) {
        headers[name] = value
      }
    }
    const id = crypto.randomUUID()
    const send = (frame: SealMcpRelayToHostFrame): void => {
      try {
        host.send(JSON.stringify(frame))
      } catch {
        // The host socket closed; webSocketClose fails what is pending.
      }
    }
    const abandon = (): void => {
      if (this.pending.delete(id)) {
        send({ t: 'abort', id })
      }
    }
    let answer: (response: Response) => void = () => {}
    const answered = new Promise<Response>((resolve) => {
      answer = resolve
    })
    this.pending.set(id, { head: answer, body: null })
    const timeout = setTimeout(() => {
      abandon()
      answer(plain(504, 'host_timeout'))
    }, HEAD_TIMEOUT_MS)
    request.signal.addEventListener('abort', abandon, { once: true })
    send({
      t: 'request',
      id,
      method: request.method,
      headers,
      body,
      remote: request.headers.get('cf-connecting-ip')
    })
    try {
      return await answered
    } finally {
      clearTimeout(timeout)
    }
  }

  webSocketMessage(_ws: WebSocket, message: string | ArrayBuffer): void {
    const frame = typeof message === 'string' ? parseSealMcpHostToRelayFrame(message) : null
    const waiting = frame ? this.pending.get(frame.id) : undefined
    if (!frame || !waiting) {
      return
    }
    switch (frame.t) {
      case 'head': {
        const headers = new Headers()
        for (const name of SEAL_MCP_RELAY_RESPONSE_HEADERS) {
          if (frame.headers[name] !== undefined) {
            headers.set(name, frame.headers[name])
          }
        }
        const body = new ReadableStream<Uint8Array>({
          start: (controller) => {
            waiting.body = controller
          },
          // The caller hung up mid-stream.
          cancel: () => {
            if (this.pending.delete(frame.id)) {
              this.sendToHost({ t: 'abort', id: frame.id })
            }
          }
        })
        waiting.head(
          new Response(NULL_BODY_STATUSES.has(frame.status) ? null : body, {
            status: frame.status,
            headers
          })
        )
        return
      }
      case 'chunk':
        waiting.body?.enqueue(new TextEncoder().encode(frame.data))
        return
      case 'end':
        this.pending.delete(frame.id)
        if (waiting.body) {
          waiting.body.close()
        } else {
          waiting.head(plain(502, 'host_sent_no_response'))
        }
    }
  }

  webSocketClose(ws: WebSocket): void {
    this.hostGone(ws)
  }

  webSocketError(ws: WebSocket): void {
    this.hostGone(ws)
  }

  /** A replaced socket finishing its close must not fail requests on its successor. */
  private hostGone(ws: WebSocket): void {
    const live = this.ctx
      .getWebSockets(HOST_TAG)
      .some((socket) => socket !== ws && socket.readyState === WebSocket.OPEN)
    if (!live) {
      this.failAll()
    }
  }

  private sendToHost(frame: SealMcpRelayToHostFrame): void {
    try {
      this.ctx.getWebSockets(HOST_TAG)[0]?.send(JSON.stringify(frame))
    } catch {
      // Nothing to tell a host that is gone.
    }
  }

  private failAll(): void {
    for (const [id, waiting] of this.pending) {
      this.pending.delete(id)
      if (waiting.body) {
        waiting.body.error(new Error('host disconnected'))
      } else {
        waiting.head(plain(502, 'host_disconnected'))
      }
    }
  }
}
