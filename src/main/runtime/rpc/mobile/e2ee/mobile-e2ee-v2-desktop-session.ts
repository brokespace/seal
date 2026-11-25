import nacl from 'tweetnacl'
import {
  encodeMobileE2EEV2Transcript,
  validateMobileE2EEV2Handshake,
  type MobileE2EETransport,
  type MobileE2EEV2Hello,
  type MobileE2EEV2Ready
} from '../../../../../shared/remote-runtime/e2ee/mobile-e2ee-v2-contract'
import {
  openMobileE2EEV2Frame,
  sealMobileE2EEV2Frame
} from '../../../../../shared/remote-runtime/e2ee/mobile-e2ee-v2-framing'
import { x25519 } from '../../../../../shared/remote-runtime/e2ee/node/e2ee-crypto'
import { contributoryX25519SharedSecret } from '../../../../../shared/remote-runtime/e2ee/x25519-low-order-points'
import { deriveMobileE2EEV2KeySchedule } from '../../../../../shared/remote-runtime/e2ee/node/mobile-e2ee-v2-node-key-schedule'
import { REMOTE_RUNTIME_MAX_OUTBOUND_JSON_BYTES } from '../../../../../shared/remote-runtime/remote-runtime-memory-limits'

const MOBILE_E2EE_V2_FRAME_OVERHEAD_BYTES = 82
export const MAX_MOBILE_E2EE_V2_TEXT_FRAME_BASE64_CHARACTERS =
  Math.ceil((REMOTE_RUNTIME_MAX_OUTBOUND_JSON_BYTES + MOBILE_E2EE_V2_FRAME_OVERHEAD_BYTES) / 3) * 4

export type DesktopMobileE2EEV2Context = {
  transport: MobileE2EETransport
  relayHostId?: string
}

export class DesktopMobileE2EEV2Session {
  private inboundCounter = 0n
  private outboundCounter = 0n

  private constructor(
    readonly ready: MobileE2EEV2Ready,
    readonly transcriptHashB64: string,
    private readonly mobileToDesktopKey: Uint8Array,
    private readonly desktopToMobileKey: Uint8Array,
    private readonly sessionId: Uint8Array
  ) {}

  static create(args: {
    hello: unknown
    serverSecretKey: Uint8Array
    expectedContext: DesktopMobileE2EEV2Context
    randomBytes?: (length: number) => Uint8Array
    // Tests pin the per-session key; production always draws a fresh one.
    ephemeralKeyPair?: { publicKey: Uint8Array; secretKey: Uint8Array }
  }): DesktopMobileE2EEV2Session | null {
    if (!hasExpectedContext(args.hello, args.expectedContext)) {
      return null
    }
    const hello = args.hello as MobileE2EEV2Hello
    const serverKeys = nacl.box.keyPair.fromSecretKey(args.serverSecretKey)
    const ephemeralKeys = args.ephemeralKeyPair ?? nacl.box.keyPair()
    const randomBytes = args.randomBytes ?? ((length: number) => nacl.randomBytes(length))
    const ready: MobileE2EEV2Ready = {
      type: 'e2ee_ready',
      v: 2,
      desktopPublicKeyB64: Buffer.from(serverKeys.publicKey).toString('base64'),
      desktopEphemeralPublicKeyB64: Buffer.from(ephemeralKeys.publicKey).toString('base64'),
      clientNonceB64: hello.clientNonceB64,
      desktopNonceB64: Buffer.from(randomBytes(32)).toString('base64'),
      selection: { framing: 2, payloadKinds: ['text', 'binary'], forwardSecrecy: true },
      context: hello.context
    }
    const handshake = validateMobileE2EEV2Handshake(hello, ready)
    if (!handshake) {
      return null
    }
    const staticSharedSecret = contributoryX25519SharedSecret(
      x25519,
      args.serverSecretKey,
      handshake.clientPublicKey
    )
    const ephemeralSharedSecret = contributoryX25519SharedSecret(
      x25519,
      ephemeralKeys.secretKey,
      handshake.clientPublicKey
    )
    if (!staticSharedSecret || !ephemeralSharedSecret) {
      return null
    }
    const schedule = deriveMobileE2EEV2KeySchedule({
      staticSharedSecret,
      ephemeralSharedSecret,
      transcript: encodeMobileE2EEV2Transcript(handshake),
      clientNonce: handshake.clientNonce,
      desktopNonce: handshake.desktopNonce
    })
    // Why wiped: forward secrecy holds only if this socket's ephemeral secrets do not outlive the handshake.
    staticSharedSecret.fill(0)
    ephemeralSharedSecret.fill(0)
    if (!args.ephemeralKeyPair) {
      ephemeralKeys.secretKey.fill(0)
    }
    return new DesktopMobileE2EEV2Session(
      ready,
      Buffer.from(schedule.transcriptHash).toString('base64'),
      schedule.mobileToDesktopKey,
      schedule.desktopToMobileKey,
      schedule.sessionId
    )
  }

  openText(frameB64: string): string | null {
    const frame = decodeCanonicalBase64(frameB64, MAX_MOBILE_E2EE_V2_TEXT_FRAME_BASE64_CHARACTERS)
    if (!frame) {
      return null
    }
    const plaintext = this.open(frame, 'text')
    return plaintext ? new TextDecoder().decode(plaintext) : null
  }

  openBinary(frame: Uint8Array): Uint8Array | null {
    return this.open(frame, 'binary')
  }

  sealText(plaintext: string): string {
    return Buffer.from(this.seal(new TextEncoder().encode(plaintext), 'text')).toString('base64')
  }

  sealBinary(plaintext: Uint8Array): Uint8Array {
    return this.seal(plaintext, 'binary')
  }

  private open(frame: Uint8Array, payloadKind: 'text' | 'binary'): Uint8Array | null {
    const plaintext = openMobileE2EEV2Frame({
      frame,
      key: this.mobileToDesktopKey,
      sessionId: this.sessionId,
      direction: 'mobile-to-desktop',
      payloadKind,
      expectedCounter: this.inboundCounter
    })
    if (plaintext) {
      this.inboundCounter++
    }
    return plaintext
  }

  private seal(plaintext: Uint8Array, payloadKind: 'text' | 'binary'): Uint8Array {
    const frame = sealMobileE2EEV2Frame({
      payload: plaintext,
      key: this.desktopToMobileKey,
      sessionId: this.sessionId,
      direction: 'desktop-to-mobile',
      payloadKind,
      counter: this.outboundCounter
    })
    this.outboundCounter++
    return frame
  }
}

function hasExpectedContext(
  hello: unknown,
  expected: DesktopMobileE2EEV2Context
): hello is MobileE2EEV2Hello {
  if (typeof hello !== 'object' || hello === null || !('context' in hello)) {
    return false
  }
  const context = (hello as { context?: unknown }).context
  if (typeof context !== 'object' || context === null) {
    return false
  }
  const candidate = context as { transport?: unknown; relayHostId?: unknown }
  return (
    candidate.transport === expected.transport && candidate.relayHostId === expected.relayHostId
  )
}

function decodeCanonicalBase64(value: string, maxEncodedCharacters: number): Uint8Array | null {
  if (
    value.length > maxEncodedCharacters ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    return null
  }
  const bytes = Buffer.from(value, 'base64')
  return bytes.toString('base64') === value ? bytes : null
}
