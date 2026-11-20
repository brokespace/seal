// Keep E2EE framing outside transport-independent plaintext RPC handlers.
import type { WebSocket } from 'ws'
import { PAIRED_E2EE_HANDSHAKE_DEADLINE_MS } from '../../../../../shared/remote-runtime/e2ee/paired-e2ee-handshake-deadline'
import {
  DesktopMobileE2EEV2Session,
  type DesktopMobileE2EEV2Context
} from './mobile-e2ee-v2-desktop-session'
import type { DesktopMobileE2EEV2OutboundItem as V2OutboundItem } from './mobile-e2ee-v2-desktop-outbound'
import { handleDesktopMobileE2EEV2Inbound } from './mobile-e2ee-v2-desktop-inbound'
import {
  authenticateMobileE2EE,
  describeMobileE2EEAuthFailure,
  type DeviceKeyResolution
} from './mobile-e2ee-auth-validation'
import { isCompressibleReplyRequest } from './mobile-e2ee-compressible-reply-methods'
import {
  isMobileE2EEOutboundItemWithinLimit,
  trackMobileE2EEOutboundBudgetClose,
  type MobileE2EEOutboundBudgetEmitter
} from './mobile-e2ee-outbound-admission'
import { parseRemoteRuntimeJsonText } from '../../../../../shared/remote-runtime/requests/remote-runtime-request-frames'
import type { MobileE2EEOutboundMemoryBudget } from './mobile-e2ee-outbound-memory-budget'
import { MobileE2EEDesktopOutboundOwner } from './mobile-e2ee-desktop-outbound-owner'
import { RuntimeClientCapabilities } from '../../callers/runtime-client-capabilities'
import type * as RpcBinary from '../../transports/rpc-binary-sender'
import type { E2EEAuthenticatedDevice } from '../../server/mobile-e2ee-authenticated-device'

const MAX_CONSECUTIVE_DECRYPT_FAILURES = 5

export type E2EEChannelOptions = {
  serverSecretKey: Uint8Array
  resolveAuthenticatedDevice: (token: string) => E2EEAuthenticatedDevice | null
  // Absent: key auth is refused as bad_auth, the same as before device keys existed.
  resolveAuthenticatedDeviceKey?: (deviceId: string) => DeviceKeyResolution<E2EEAuthenticatedDevice>
  onReady: (channel: E2EEChannel, device: E2EEAuthenticatedDevice) => void
  onError: (code: number, reason: string) => void
  transportContext?: DesktopMobileE2EEV2Context
  outboundMemoryBudget?: MobileE2EEOutboundMemoryBudget
}

export class E2EEChannel {
  private state: 'awaiting_hello' | 'awaiting_auth' | 'ready' = 'awaiting_hello'
  private consecutiveFailures = 0
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null
  private readonly ws: WebSocket
  private readonly serverSecretKey: Uint8Array
  private readonly resolvers: Pick<
    E2EEChannelOptions,
    'resolveAuthenticatedDevice' | 'resolveAuthenticatedDeviceKey'
  >
  private readonly onReady: (channel: E2EEChannel, device: E2EEAuthenticatedDevice) => void
  private readonly onError: (code: number, reason: string) => void
  private readonly transportContext: DesktopMobileE2EEV2Context
  private readonly outbound: MobileE2EEDesktopOutboundOwner
  private v2Session: DesktopMobileE2EEV2Session | null = null
  // Install the handler after readiness so its reply closure has encryption state.
  private messageHandler:
    | ((
        plaintext: string,
        encryptedReply: (response: string) => void,
        encryptedBinaryReply: RpcBinary.RpcBinarySender
      ) => void)
    | null = null
  private binaryMessageHandler: ((plaintext: Uint8Array<ArrayBufferLike>) => void) | null = null

  deviceToken: string | null = null

  /** The transcript this socket is keyed under; null until its hello is accepted. */
  get transcriptHashB64(): string | null {
    return this.v2Session?.transcriptHashB64 ?? null
  }
  authenticatedDevice: E2EEAuthenticatedDevice | null = null
  readonly capabilitySource = new RuntimeClientCapabilities()

  constructor(ws: WebSocket, options: E2EEChannelOptions) {
    this.ws = ws
    this.serverSecretKey = options.serverSecretKey
    this.resolvers = options
    this.onReady = options.onReady
    this.onError = options.onError
    this.transportContext = options.transportContext ?? { transport: 'direct' }
    this.outbound = new MobileE2EEDesktopOutboundOwner(
      ws,
      () => this.closeForOutboundBudget('queue'),
      this.capabilitySource,
      options.outboundMemoryBudget
    )

    this.handshakeTimer = setTimeout(() => {
      this.onError(4002, 'E2EE handshake timeout')
    }, PAIRED_E2EE_HANDSHAKE_DEADLINE_MS)
  }

  onMessage(
    handler: (
      plaintext: string,
      encryptedReply: (response: string) => void,
      encryptedBinaryReply: RpcBinary.RpcBinarySender
    ) => void
  ): void {
    this.messageHandler = handler
  }

  onBinaryMessage(handler: (plaintext: Uint8Array<ArrayBufferLike>) => void): void {
    this.binaryMessageHandler = handler
  }

  handleRawMessage(raw: string | Uint8Array<ArrayBufferLike>): void {
    if (this.state === 'awaiting_hello') {
      if (typeof raw !== 'string') {
        this.onError(4001, 'Invalid handshake message')
        return
      }
      this.handleHello(raw)
      return
    }

    if (this.v2Session) {
      this.handleV2RawMessage(raw)
    }
  }

  private trackDecryptFailure(): void {
    // A wrong key cannot recover on this socket; closing invokes the client's bounded auth retry.
    if (this.state === 'awaiting_auth') {
      this.onError(4001, 'Unauthorized')
    } else if (++this.consecutiveFailures >= MAX_CONSECUTIVE_DECRYPT_FAILURES) {
      this.onError(4003, 'Too many decryption failures')
    }
  }

  private handleHello(raw: string): void {
    let hello: Record<string, unknown>
    try {
      const parsed = parseRemoteRuntimeJsonText(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        this.onError(4001, 'Invalid handshake message')
        return
      }
      hello = { ...parsed }
    } catch {
      this.onError(4001, 'Invalid handshake message')
      return
    }

    // Why no other framing: only v2 binds host randomness and counters, so nothing older is answered.
    if (hello.type !== 'e2ee_hello' || hello.v !== 2) {
      this.onError(4001, 'E2EE v2 required')
      return
    }
    const session = DesktopMobileE2EEV2Session.create({
      hello,
      serverSecretKey: this.serverSecretKey,
      expectedContext: this.transportContext
    })
    if (!session) {
      this.onError(4001, 'Invalid e2ee_hello v2')
      return
    }
    this.v2Session = session
    this.state = 'awaiting_auth'
    // Ready must be plaintext so the peer can begin encrypted authentication.
    if (this.ws.readyState === this.ws.OPEN) {
      this.ws.send(JSON.stringify(session.ready))
    }
  }

  private handleAuth(plaintext: string): void {
    const session = this.v2Session
    if (!session) {
      return
    }
    const authentication = authenticateMobileE2EE({
      plaintext,
      v2Session: session,
      v2TokenCapabilities: this.transportContext.transport === 'direct',
      resolveDevice: this.resolvers.resolveAuthenticatedDevice,
      resolveDeviceKey: this.resolvers.resolveAuthenticatedDeviceKey
    })
    if (!authentication.ok) {
      const failure = describeMobileE2EEAuthFailure(authentication)
      this.sendEncryptedControl(failure.sealedError)
      this.onError(4001, failure.closeReason)
      return
    }
    const authenticatedDevice = authentication.device

    this.capabilitySource.replace(authentication.clientCapabilities)
    this.deviceToken = authenticatedDevice.deviceToken ?? null
    this.authenticatedDevice = authenticatedDevice
    this.state = 'ready'
    clearTimeout(this.handshakeTimer ?? undefined)
    this.handshakeTimer = null

    // Complete transport identity checks before auth success; relay resolvers also bind immutable relayDeviceId.
    this.onReady(this, authenticatedDevice)
    this.sendEncryptedControl({
      type: 'e2ee_authenticated',
      v: 2,
      transcriptHashB64: session.transcriptHashB64
    })
  }

  private handleV2RawMessage(raw: string | Uint8Array<ArrayBufferLike>): void {
    handleDesktopMobileE2EEV2Inbound({
      session: this.v2Session!,
      raw,
      awaitingAuth: this.state === 'awaiting_auth',
      onDecryptFailure: () => this.trackDecryptFailure(),
      onDecryptSuccess: () => (this.consecutiveFailures = 0),
      onAuth: (plaintext) => this.handleAuth(plaintext),
      onBinary: (plaintext) => this.binaryMessageHandler?.(plaintext),
      onText: (plaintext) => {
        // Why per request: only replies to listed bulk methods may show their compressed length.
        const replyOptions = isCompressibleReplyRequest(plaintext)
          ? { compressible: true }
          : undefined
        this.messageHandler?.(
          plaintext,
          (response) => this.enqueueV2({ kind: 'text', plaintext: response }, replyOptions),
          (response, options) => this.enqueueV2({ kind: 'binary', plaintext: response }, options)
        )
      },
      onProtocolError: () => this.onError(4001, 'Invalid binary message before authentication')
    })
  }

  private enqueueV2(
    item: V2OutboundItem,
    options?: RpcBinary.RpcBinarySendOptions
  ): RpcBinary.RpcBinarySendResult {
    if (!this.v2Session || this.ws.readyState !== this.ws.OPEN) {
      return false
    }
    if (!isMobileE2EEOutboundItemWithinLimit(item)) {
      this.closeForOutboundBudget('size')
      return false
    }
    return this.outbound.enqueueV2(item, this.v2Session, options)
  }

  // Both budget closes kill the remote session: size identifies an oversized producer, queue a backed-up link.
  private closeForOutboundBudget(emitter: MobileE2EEOutboundBudgetEmitter): void {
    trackMobileE2EEOutboundBudgetClose(emitter)
    this.onError(1013, 'Outbound reply buffer overflow')
  }

  private sendEncryptedControl(message: unknown): void {
    this.enqueueV2({ kind: 'text', plaintext: JSON.stringify(message) })
  }

  destroy(): void {
    this.capabilitySource.dispose()
    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer)
      this.handshakeTimer = null
    }
    this.authenticatedDevice = null
    this.v2Session = null
    this.messageHandler = null
    this.binaryMessageHandler = null
    this.outbound.dispose()
  }
}
