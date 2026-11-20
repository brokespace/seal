import { PAIRED_E2EE_HANDSHAKE_DEADLINE_MS } from '../../../../src/shared/remote-runtime/e2ee/paired-e2ee-handshake-deadline'
import { createDirectSocketFraming, type DirectSocketFraming } from './direct-socket-framing'
import { isRpcResponse } from './rpc-response-shape'
import { AUTH_REJECTED } from './rpc-client-authentication-retry'
import { isStaleRpcSocketEvent, logRpcSocketClose } from './rpc-socket-close-evidence'
import {
  describeSocketEvent,
  redactSocketEndpoint
} from '../../diagnostics/connection/socket-event-debug'
import {
  reportSocketDeadline,
  type SocketDeadlineKind
} from '../../diagnostics/connection/socket-deadline-suspension'
import { startSocketDeadlineClock } from '../connection/socket-deadline-clock'
import { receiveBinaryAsBase64 } from '../encryption/websocket-payload-bytes'
import type { ConnectionLogEmitter } from '../../diagnostics/connection/connection-log-types'
import type { ConnectionState } from '../connection/connection-state'
import type { RpcRequest, RpcResponse } from './rpc-wire-types'

const CONNECT_TIMEOUT_MS = 12_000
const WEBSOCKET_CONNECTING_STATE = 0
const UNAUTHORIZED_CLOSE_CODE = 4001

type SocketSessionOptions = {
  endpoint: string
  deviceToken: string
  serverPublicKeyB64: string
  getCurrentSocket: () => WebSocket | null
  getState: () => ConnectionState
  getReconnectAttempt: () => number
  isIntentionallyClosed: () => boolean
  emitLog: ConnectionLogEmitter
  onHandshakeStarted: () => void
  onAuthenticated: (session: RpcClientSocketSession) => void
  onAuthRejected: (reason: string) => void
  onRpcResponse: (session: RpcClientSocketSession, response: RpcResponse) => void
  onBinary: (bytes: Uint8Array) => void
  onAnyInbound: (receivedAt: number) => void
  onAuthenticatedInbound: (session: RpcClientSocketSession) => void
  onClosed: (session: RpcClientSocketSession, closeCode?: number) => void
  onForcedClose: (session: RpcClientSocketSession) => void
}

export class RpcClientSocketSession {
  readonly socket: WebSocket
  readonly constructedAt = Date.now()
  private framing: DirectSocketFraming | null = null
  private readyAccepted = false
  private authenticated = false
  private lastInboundAt: number | null = null
  private connectTimer: ReturnType<typeof setTimeout> | null = null
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly options: SocketSessionOptions) {
    this.socket = receiveBinaryAsBase64(new WebSocket(options.endpoint))
    this.attachHandlers()
    this.armConnectTimeout()
  }

  sendEncrypted(request: RpcRequest): boolean {
    if (this.socket.readyState === WebSocket.OPEN && this.framing) {
      try {
        if (this.framing.sendText(JSON.stringify(request))) {
          return true
        }
      } catch {
        if (this.options.getCurrentSocket() === this.socket) {
          this.options.onForcedClose(this)
        }
        return false
      }
    }
    console.log('[net] sendEncrypted FAILED — channel not ready', {
      hasWs: this.options.getCurrentSocket() !== null,
      readyState: this.socket.readyState,
      hasKey: this.framing !== null,
      state: this.options.getState()
    })
    if (
      this.options.getState() === 'connected' &&
      this.options.getCurrentSocket() === this.socket &&
      this.socket.readyState !== WebSocket.OPEN
    ) {
      console.log('[net] sendEncrypted detected ws desync — forcing reconnect', {
        readyState: this.socket.readyState
      })
      this.options.onForcedClose(this)
    }
    return false
  }

  close(): void {
    this.socket.close()
  }

  clearTimers(): void {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer)
      this.connectTimer = null
    }
    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer)
      this.handshakeTimer = null
    }
  }

  clearKey(): void {
    this.framing?.dispose()
    this.framing = null
  }

  private attachHandlers(): void {
    this.socket.onopen = () => {
      if (this.isStale('open')) {
        return
      }
      console.log('[net] ws.onopen', { attempt: this.options.getReconnectAttempt() })
      this.clearConnectTimer()
      this.options.onHandshakeStarted()
      this.options.emitLog('success', 'WebSocket open', 'Starting E2EE handshake')
      this.startHandshake()
    }
    this.socket.onmessage = (event) => {
      if (this.isStale('message')) {
        return
      }
      const receivedAt = Date.now()
      this.lastInboundAt = receivedAt
      this.options.onAnyInbound(receivedAt)
      this.framing?.handleInbound(event.data)
    }
    this.socket.onclose = (event) => {
      const closeCode = logRpcSocketClose({
        event,
        state: this.options.getState(),
        attempt: this.options.getReconnectAttempt(),
        intentionallyClosed: this.options.isIntentionallyClosed(),
        endpoint: redactSocketEndpoint(this.options.endpoint),
        constructedAt: this.constructedAt,
        authenticated: this.authenticated,
        lastInboundAt: this.lastInboundAt
      })
      if (closeCode === UNAUTHORIZED_CLOSE_CODE) {
        this.logRefusedHandshake()
      }
      this.options.onClosed(this, closeCode)
    }
    this.socket.onerror = (event) => {
      if (this.isStale('error')) {
        return
      }
      const error = event as { message?: string } | undefined
      const description = describeSocketEvent(event)
      console.log('[net] ws.onerror', {
        message: error?.message,
        state: this.options.getState(),
        attempt: this.options.getReconnectAttempt(),
        eventKeys: description.keys,
        eventStr: description.json
      })
    }
  }

  // No ready was accepted: the host cannot speak this app's framing, or it is not the paired host.
  private logRefusedHandshake(): void {
    if (this.framing && !this.readyAccepted) {
      this.options.emitLog(
        'error',
        'Host refused the encrypted handshake',
        'Update Orca on the host. If it is up to date, its identity changed: pair again.',
        { code: 'authentication-rejected' }
      )
    }
  }

  private startHandshake(): void {
    const isCurrent = () => this.options.getCurrentSocket() === this.socket
    this.framing = createDirectSocketFraming({
      socket: this.socket,
      serverPublicKeyB64: this.options.serverPublicKeyB64,
      deviceToken: this.options.deviceToken,
      emitLog: this.options.emitLog,
      events: {
        onReadyAccepted: () => {
          this.readyAccepted = true
        },
        onAuthenticated: () => {
          this.clearHandshakeTimer()
          this.authenticated = true
          this.options.onAuthenticated(this)
        },
        onText: (plaintext) => {
          if (isCurrent()) {
            this.options.onAuthenticatedInbound(this)
            this.deliverRpcText(plaintext)
          }
        },
        onBinary: (plaintext) => {
          if (isCurrent()) {
            this.options.onAuthenticatedInbound(this)
            this.options.onBinary(plaintext)
          }
        },
        onAuthRejected: () => {
          if (isCurrent()) {
            this.clearHandshakeTimer()
            this.logRefusedHandshake()
            this.options.onAuthRejected(AUTH_REJECTED)
          }
        },
        onProtocolError: (error) => {
          if (isCurrent()) {
            console.log('[net] e2ee protocol error — closing', { message: error.message })
            this.options.onForcedClose(this)
          }
        }
      }
    })
    try {
      this.framing.start()
    } catch {
      this.options.onForcedClose(this)
      return
    }
    this.armHandshakeTimeout()
  }

  private deliverRpcText(plaintext: string): void {
    let response: unknown
    try {
      response = JSON.parse(plaintext)
    } catch {
      return
    }
    if (isRpcResponse(response)) {
      this.options.onRpcResponse(this, response)
    }
  }

  private armConnectTimeout(): void {
    this.armSocketDeadline('connect', CONNECT_TIMEOUT_MS)
  }

  private armHandshakeTimeout(): void {
    this.armSocketDeadline('handshake', PAIRED_E2EE_HANDSHAKE_DEADLINE_MS)
  }

  private armSocketDeadline(kind: SocketDeadlineKind, timeoutMs: number): void {
    const elapsedMs = startSocketDeadlineClock()
    const timer = setTimeout(() => {
      if (kind === 'connect') {
        this.connectTimer = null
      } else {
        this.handshakeTimer = null
      }
      if (
        this.options.getCurrentSocket() !== this.socket ||
        (kind === 'connect'
          ? this.socket.readyState !== WEBSOCKET_CONNECTING_STATE
          : this.authenticated)
      ) {
        return
      }
      reportSocketDeadline(
        {
          kind,
          elapsedMs: elapsedMs(),
          timeoutMs,
          ...(kind === 'connect' ? { attempt: this.options.getReconnectAttempt() } : {})
        },
        this.options.emitLog,
        () => this.options.onForcedClose(this)
      )
    }, timeoutMs)
    if (kind === 'connect') {
      this.connectTimer = timer
    } else {
      this.handshakeTimer = timer
    }
  }

  private clearConnectTimer(): void {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer)
      this.connectTimer = null
    }
  }

  private clearHandshakeTimer(): void {
    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer)
      this.handshakeTimer = null
    }
  }

  private isStale(eventName: string): boolean {
    return isStaleRpcSocketEvent(
      this.options.getCurrentSocket(),
      this.socket,
      eventName,
      this.options.getState(),
      this.options.getReconnectAttempt()
    )
  }
}
