import WebSocket from 'ws'
import {
  parseSealMcpRelayToHostFrame,
  SEAL_MCP_RELAY_CHUNK_CHARS,
  SEAL_MCP_RELAY_HOST_PATH,
  SEAL_MCP_RELAY_MAX_BODY_BYTES,
  SEAL_MCP_RELAY_PING,
  SEAL_MCP_RELAY_PUBLIC_PREFIX,
  type SealMcpHostToRelayFrame,
  type SealMcpRelayRequestFrame
} from '../../../shared/seal-mcp/seal-mcp-relay-frames'
import { answerSealMcpHttp } from '../http/seal-mcp-http-exchange'
import type { SealMcpService } from '../seal-mcp-service'

const PING_INTERVAL_MS = 30_000
const SILENCE_TIMEOUT_MS = 75_000
const MIN_RETRY_MS = 1_000
const MAX_RETRY_MS = 60_000

/** How this server proves to the relay which host it is. */
export type SealMcpRelayIdentity = {
  /** The id in this server's public MCP URL: the fingerprint of its pairing key. */
  hostId: string
  /** A host session token; `stale` is one the relay just refused. */
  session: (stale: string | null) => Promise<string>
}

export type SealMcpRelayTunnelOptions = {
  relayOrigin: string
  /** Null until this server has a pairing key. */
  identity: () => SealMcpRelayIdentity | null
  service: SealMcpService
  onStatus?: () => void
  retryMs?: { min: number; max: number }
  keepAliveMs?: number
}

/**
 * The server's standing WebSocket to the Seal relay, open only while relay access is switched on.
 * Requests arriving on it are untrusted HTTP: each is authenticated and authorized here exactly
 * like one on the LAN port, and marked as relayed.
 */
export class SealMcpRelayTunnel {
  private socket: WebSocket | null = null
  private open = false
  private stopped = false
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private retryMs: number
  private lastHeardAt = 0
  private readonly inFlight = new Map<string, AbortController>()
  private readonly offSettings: () => void

  constructor(private readonly options: SealMcpRelayTunnelOptions) {
    this.retryMs = options.retryMs?.min ?? MIN_RETRY_MS
    this.offSettings = options.service.onEvent((event) => {
      if (event.type === 'settings') {
        this.sync()
      }
    })
  }

  get connected(): boolean {
    return this.open
  }

  /** The URL a cloud MCP client is given, or null before this server has a pairing key. */
  get publicUrl(): string | null {
    const identity = this.options.identity()
    return identity
      ? `${this.options.relayOrigin}${SEAL_MCP_RELAY_PUBLIC_PREFIX}${identity.hostId}`
      : null
  }

  start(): void {
    this.sync()
  }

  stop(): void {
    this.stopped = true
    this.offSettings()
    this.disconnect()
  }

  private wanted(): boolean {
    return !this.stopped && this.options.service.getSettings().relayEnabled
  }

  private sync(): void {
    if (!this.wanted()) {
      this.disconnect()
    } else if (!this.socket && !this.retryTimer) {
      void this.connect(null)
    }
  }

  private disconnect(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    const socket = this.socket
    this.socket = null
    socket?.terminate()
    this.closed()
  }

  private async connect(staleSession: string | null): Promise<void> {
    const identity = this.options.identity()
    if (!identity) {
      this.retryLater()
      return
    }
    let token: string
    try {
      token = await identity.session(staleSession)
    } catch {
      this.retryLater()
      return
    }
    if (!this.wanted() || this.socket) {
      return
    }
    const url = `${this.options.relayOrigin.replace(/^http/, 'ws')}${SEAL_MCP_RELAY_HOST_PATH}`
    const socket = new WebSocket(url, { headers: { authorization: `Bearer ${token}` } })
    this.socket = socket
    socket.on('open', () => {
      this.open = true
      this.retryMs = this.options.retryMs?.min ?? MIN_RETRY_MS
      this.lastHeardAt = Date.now()
      this.pingTimer = setInterval(() => this.ping(socket), PING_INTERVAL_MS)
      this.options.onStatus?.()
    })
    socket.on('message', (data, isBinary) => {
      this.lastHeardAt = Date.now()
      if (!isBinary) {
        this.receive(socket, data.toString())
      }
    })
    // The relay answers a bad or expired session with 401 instead of upgrading.
    socket.on('unexpected-response', (_request, response) => {
      response.resume()
      this.dropped(socket, response.statusCode === 401 ? token : null)
    })
    socket.on('error', () => this.dropped(socket, null))
    socket.on('close', () => this.dropped(socket, null))
  }

  private ping(socket: WebSocket): void {
    if (Date.now() - this.lastHeardAt > SILENCE_TIMEOUT_MS) {
      socket.terminate()
      return
    }
    socket.send(SEAL_MCP_RELAY_PING)
  }

  private dropped(socket: WebSocket, refusedSession: string | null): void {
    if (this.socket !== socket) {
      return
    }
    this.socket = null
    socket.terminate()
    this.closed()
    if (this.wanted()) {
      this.retryLater(refusedSession)
    }
  }

  private closed(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
    // Nobody is left to read the answers.
    for (const call of this.inFlight.values()) {
      call.abort()
    }
    this.inFlight.clear()
    if (this.open) {
      this.open = false
      this.options.onStatus?.()
    }
  }

  private retryLater(staleSession: string | null = null): void {
    if (this.retryTimer || !this.wanted()) {
      return
    }
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      if (this.wanted() && !this.socket) {
        void this.connect(staleSession)
      }
    }, this.retryMs)
    this.retryMs = Math.min(this.retryMs * 2, this.options.retryMs?.max ?? MAX_RETRY_MS)
  }

  private receive(socket: WebSocket, text: string): void {
    const frame = parseSealMcpRelayToHostFrame(text)
    if (!frame) {
      return
    }
    if (frame.t === 'abort') {
      this.inFlight.get(frame.id)?.abort()
      return
    }
    void this.answer(socket, frame)
  }

  private async answer(socket: WebSocket, frame: SealMcpRelayRequestFrame): Promise<void> {
    const { id } = frame
    const gone = new AbortController()
    this.inFlight.set(id, gone)
    const send = (reply: SealMcpHostToRelayFrame): void => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(reply))
      }
    }
    const sendBody = (text: string): void => {
      for (let at = 0; at < text.length; at += SEAL_MCP_RELAY_CHUNK_CHARS) {
        send({ t: 'chunk', id, data: text.slice(at, at + SEAL_MCP_RELAY_CHUNK_CHARS) })
      }
    }
    let answered = false
    try {
      await answerSealMcpHttp(this.options.service, {
        method: frame.method,
        headers: frame.headers,
        readBody: () =>
          Promise.resolve(
            Buffer.byteLength(frame.body) > SEAL_MCP_RELAY_MAX_BODY_BYTES ? null : frame.body
          ),
        peer: { transport: 'relay', remote: frame.remote },
        signal: gone.signal,
        keepAliveMs: this.options.keepAliveMs,
        respond: (status, headers, body) => {
          answered = true
          send({ t: 'head', id, status, headers })
          sendBody(body ?? '')
          send({ t: 'end', id })
        },
        openStream: (status, headers) => {
          answered = true
          send({ t: 'head', id, status, headers })
          return { write: sendBody, end: () => send({ t: 'end', id }) }
        }
      })
    } catch {
      if (!answered) {
        send({ t: 'head', id, status: 500, headers: {} })
      }
      send({ t: 'end', id })
    } finally {
      this.inFlight.delete(id)
    }
  }
}
