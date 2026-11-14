import { DurableObject } from 'cloudflare:workers'
import { RELAY_CLOSE_CODE } from '../../../cloud/packages/relay-contract/src/close-codes'
import { readBearer } from '../../../cloud/apps/relay-edge/src/jwt'
import {
  parseSealMcpHostToRelayFrame,
  SEAL_MCP_RELAY_HOST_PATH,
  SEAL_MCP_RELAY_MAX_BODY_BYTES,
  SEAL_MCP_RELAY_MAX_FRAME_BYTES,
  SEAL_MCP_RELAY_MAX_IN_FLIGHT,
  SEAL_MCP_RELAY_PING,
  SEAL_MCP_RELAY_PONG,
  SEAL_MCP_RELAY_REQUEST_HEADERS,
  SEAL_MCP_RELAY_RESPONSE_HEADERS,
  type SealMcpRelayToHostFrame
} from '../../../src/shared/seal-mcp/seal-mcp-relay-frames'
import { readCappedBody } from './capped-request-body'
import type { SealEnv } from './env'
import { verifyHostSession } from './host-auth'
import { hostEnrolled } from './seal-relay-config'

const HOST_TAG = 'host'
/** A host answers the head at once unless a JSON-mode call waits on a person's approval. */
const HEAD_TIMEOUT_MS = 180_000
/** The host writes to an open answer every 15 s; one silent this long has stalled. */
const STREAM_IDLE_TIMEOUT_MS = 60_000
/** The host pings every 30 s; one silent this long is gone even if its socket lingers. */
const HOST_SILENCE_TIMEOUT_MS = 90_000
/** An answer the caller is not reading is dropped rather than held here without bound. */
const MAX_BUFFERED_ANSWER_BYTES = 8 * 1024 * 1024
const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([204, 205, 304])
const OPEN = 1

type Pending = {
  head: (response: Response) => void
  body: ReadableStreamDefaultController<Uint8Array> | null
  timer: ReturnType<typeof setTimeout>
}

/** What the object remembers about the host socket across hibernation. */
type HostSeat = { hostFingerprint: string; sessionExpiresAt: number; acceptedAt: number }

function plain(status: number, error: string, headers: Record<string, string> = {}): Response {
  return Response.json({ error }, { status, headers })
}

function seatOf(socket: WebSocket): HostSeat | null {
  return (socket.deserializeAttachment() as HostSeat | null) ?? null
}

/**
 * One object per enrolled host. It holds the host's outbound WebSocket and passes each public MCP
 * request down it, byte for byte. It keeps no tokens, stores nothing and decides nothing: the host
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

  /** The Worker verified the session before routing here; its expiry is read again to bound the socket. */
  private acceptHost(request: Request): Response {
    const session = verifyHostSession(
      this.env.HOST_SESSION_SECRET,
      readBearer(request.headers.get('authorization'))
    )
    if (!session) {
      return plain(401, 'unauthorized')
    }
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
    pair[1].serializeAttachment({
      hostFingerprint: session.hostFingerprint,
      sessionExpiresAt: session.expiresAt,
      acceptedAt: Date.now()
    } satisfies HostSeat)
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  /** The host's socket, unless its session ran out or it stopped answering: then it is cut. */
  private liveHost(): WebSocket | null {
    const host = this.ctx.getWebSockets(HOST_TAG).find((socket) => socket.readyState === OPEN)
    if (!host) {
      return null
    }
    const seat = seatOf(host)
    const now = Date.now()
    const heardAt = Math.max(
      seat?.acceptedAt ?? 0,
      this.ctx.getWebSocketAutoResponseTimestamp(host)?.getTime() ?? 0
    )
    const expired =
      !seat ||
      seat.sessionExpiresAt <= now ||
      !hostEnrolled(this.env, seat.hostFingerprint)
    if (expired || now - heardAt > HOST_SILENCE_TIMEOUT_MS) {
      host.close(
        expired ? RELAY_CLOSE_CODE.BAD_OUTER_CREDENTIAL : RELAY_CLOSE_CODE.PEER_DROPPED,
        expired ? 'session expired' : 'idle timeout'
      )
      this.failAll()
      return null
    }
    return host
  }

  private async forward(request: Request): Promise<Response> {
    const host = this.liveHost()
    if (!host) {
      return plain(503, 'host_offline', { 'retry-after': '10' })
    }
    // The Worker already capped the body; this bounds a caller that reaches the object another way.
    const body = await readCappedBody(request, SEAL_MCP_RELAY_MAX_BODY_BYTES)
    if (body === null) {
      return plain(413, 'body_too_large')
    }
    if (this.pending.size >= SEAL_MCP_RELAY_MAX_IN_FLIGHT) {
      return plain(429, 'too_many_requests', { 'retry-after': '5' })
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
      if (this.drop(id)) {
        send({ t: 'abort', id })
      }
    }
    let answer: (response: Response) => void = () => {}
    const answered = new Promise<Response>((resolve) => {
      answer = resolve
    })
    this.pending.set(id, {
      head: answer,
      body: null,
      timer: setTimeout(() => {
        abandon()
        answer(plain(504, 'host_timeout'))
      }, HEAD_TIMEOUT_MS)
    })
    request.signal.addEventListener('abort', abandon, { once: true })
    send({
      t: 'request',
      id,
      method: request.method,
      headers,
      body,
      remote: request.headers.get('cf-connecting-ip')
    })
    return answered
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message !== 'string' || message.length > SEAL_MCP_RELAY_MAX_FRAME_BYTES) {
      return
    }
    const frame = parseSealMcpHostToRelayFrame(message)
    if (frame?.t === 'session') {
      this.renewSeat(ws, frame.token)
      return
    }
    const waiting = frame ? this.pending.get(frame.id) : undefined
    if (!frame || !waiting) {
      return
    }
    const { id } = frame
    switch (frame.t) {
      case 'head': {
        if (waiting.body) {
          return
        }
        const headers = new Headers()
        for (const name of SEAL_MCP_RELAY_RESPONSE_HEADERS) {
          if (frame.headers[name] !== undefined) {
            headers.set(name, frame.headers[name])
          }
        }
        const body = new ReadableStream<Uint8Array>(
          {
            start: (controller) => {
              waiting.body = controller
            },
            // The caller hung up mid-stream.
            cancel: () => this.abortAnswer(id)
          },
          new ByteLengthQueuingStrategy({ highWaterMark: MAX_BUFFERED_ANSWER_BYTES })
        )
        this.rearm(waiting, id)
        waiting.head(
          new Response(NULL_BODY_STATUSES.has(frame.status) ? null : body, {
            status: frame.status,
            headers
          })
        )
        return
      }
      case 'chunk': {
        const controller = waiting.body
        if (!controller) {
          return
        }
        if ((controller.desiredSize ?? 0) <= 0) {
          controller.error(new Error('answer not read'))
          this.abortAnswer(id)
          return
        }
        this.rearm(waiting, id)
        controller.enqueue(new TextEncoder().encode(frame.data))
        return
      }
      case 'end':
        this.drop(id)
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

  /** A host that keeps its tunnel past one session's life proves it still holds its key. */
  private renewSeat(ws: WebSocket, token: string): void {
    const seat = seatOf(ws)
    const session = verifyHostSession(this.env.HOST_SESSION_SECRET, token)
    if (seat && session?.hostFingerprint === seat.hostFingerprint) {
      ws.serializeAttachment({
        ...seat,
        sessionExpiresAt: Math.max(seat.sessionExpiresAt, session.expiresAt)
      } satisfies HostSeat)
    }
  }

  /** An open answer the host stopped writing to is ended, so it cannot hold its seat forever. */
  private rearm(waiting: Pending, id: string): void {
    clearTimeout(waiting.timer)
    waiting.timer = setTimeout(() => {
      waiting.body?.error(new Error('host stalled'))
      this.abortAnswer(id)
    }, STREAM_IDLE_TIMEOUT_MS)
  }

  private drop(id: string): boolean {
    const waiting = this.pending.get(id)
    if (!waiting) {
      return false
    }
    clearTimeout(waiting.timer)
    return this.pending.delete(id)
  }

  private abortAnswer(id: string): void {
    if (this.drop(id)) {
      this.sendToHost({ t: 'abort', id })
    }
  }

  /** A replaced socket finishing its close must not fail requests on its successor. */
  private hostGone(ws: WebSocket): void {
    const live = this.ctx
      .getWebSockets(HOST_TAG)
      .some((socket) => socket !== ws && socket.readyState === OPEN)
    if (!live) {
      this.failAll()
    }
  }

  private sendToHost(frame: SealMcpRelayToHostFrame): void {
    try {
      this.ctx
        .getWebSockets(HOST_TAG)
        .find((socket) => socket.readyState === OPEN)
        ?.send(JSON.stringify(frame))
    } catch {
      // Nothing to tell a host that is gone.
    }
  }

  private failAll(): void {
    for (const [id, waiting] of this.pending) {
      this.drop(id)
      if (waiting.body) {
        waiting.body.error(new Error('host disconnected'))
      } else {
        waiting.head(plain(502, 'host_disconnected'))
      }
    }
  }
}
