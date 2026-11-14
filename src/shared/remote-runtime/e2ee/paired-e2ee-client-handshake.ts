import { encodeDeviceProofMessage } from '../pairing/device-key-proof'
import type { MobileE2EETransport } from './mobile-e2ee-v2-contract'
import type { PairedE2EEKeyPair, PairedE2EEPrimitives } from './paired-e2ee-primitives'
import { PairedE2EEV2ClientSession } from './paired-e2ee-v2-client-session'

// Device-key/ticket credentials signed over the v2 transcript join this union.
export type PairedE2EEAuthCredential = { kind: 'token'; deviceToken: string }

// Sign the v2 auth transcript proof asynchronously so non-extractable WebCrypto keys can participate.
export type PairedE2EEDeviceKeyCredential = {
  kind: 'device-key'
  deviceId: string
  sign: (message: Uint8Array) => Promise<Uint8Array>
}

export type PairedE2EEReadyVerdict =
  | 'accepted'
  | 'invalid'
  // JSON, but not a ready this hello accepts (wrong type, bad v2 transcript, re-keyed host).
  | 'unexpected'
  // A ready from a host that predates forward-secret v2. Never a reason to try older framing.
  | 'host_outdated'

/** For a host that refuses the v2 hello or answers with older framing: there is no fallback. */
export const PAIRED_E2EE_HOST_UPDATE_REQUIRED_MESSAGE =
  'This host does not support the encryption this app requires (E2EE v2 with forward secrecy). ' +
  'Update Orca on the host, then connect again.'

export type PairedE2EEAuthReply =
  | { kind: 'authenticated' }
  // errorDeviceId: the device a sealed verdict names (device_revoked); a client acts only on its own.
  | { kind: 'rejected'; type: string | null; errorCode: string | null; errorDeviceId?: string }
  | { kind: 'invalid' }

export type PairedE2EEChannel = {
  sealText: (plaintext: string) => string
  // null = not authentic (or not yet keyed).
  openText: (frame: string) => string | null
  sealBinary: (plaintext: Uint8Array) => Uint8Array<ArrayBuffer>
  openBinary: (frame: Uint8Array) => Uint8Array | null
}

export type PairedE2EEClientHandshake = {
  // Valid once the ready is accepted.
  readonly channel: PairedE2EEChannel
  helloText: () => string
  acceptReadyText: (frame: string) => PairedE2EEReadyVerdict
  // This connection's transcript hash; null until the ready is accepted.
  transcriptHashB64: () => string | null
  sealAuth: (
    credential: PairedE2EEAuthCredential | PairedE2EEDeviceKeyCredential,
    options?: { clientCapabilities?: readonly string[] }
  ) => Promise<string>
  classifyAuthReply: (plaintext: string) => PairedE2EEAuthReply
}

export type PairedE2EEClientHandshakeArgs = {
  primitives: PairedE2EEPrimitives
  hostPublicKeyB64: string
  transport: MobileE2EETransport
  relayHostId?: string
  // Runtime clients pass their structure-limited parser and size-limited serializer.
  parseJson?: (text: string) => unknown
  serializeJson?: (value: unknown) => string
  // Runtime clients carry capabilities on token auth; the relay path keeps the exact mobile shape.
  v2TokenCapabilities?: boolean
  clientKeyPair?: PairedE2EEKeyPair
  clientNonce?: Uint8Array
}

/** The only handshake a client speaks: v2 with a per-session host key. Throws on an invalid host key. */
export function createPairedE2EEClientHandshake(
  args: PairedE2EEClientHandshakeArgs
): PairedE2EEClientHandshake {
  const parseJson = args.parseJson ?? JSON.parse
  const serializeJson = args.serializeJson ?? JSON.stringify
  const session = PairedE2EEV2ClientSession.create({
    primitives: args.primitives,
    desktopPublicKeyB64: args.hostPublicKeyB64,
    transport: args.transport,
    relayHostId: args.relayHostId,
    clientKeyPair: args.clientKeyPair,
    clientNonce: args.clientNonce
  })
  return {
    channel: session,
    helloText: () => JSON.stringify(session.hello),
    acceptReadyText: (frame) => {
      const ready = parseJsonOrUndefined(frame, parseJson)
      if (ready === undefined) {
        return 'invalid'
      }
      if (session.acceptReady(ready)) {
        return 'accepted'
      }
      return isReadyWithoutForwardSecrecy(ready) ? 'host_outdated' : 'unexpected'
    },
    transcriptHashB64: () => (session.isReady ? session.transcriptHashB64 : null),
    sealAuth: async (credential, options) => {
      // Why read first: throws before the ready, so nothing is signed without a transcript.
      const transcriptHashB64 = session.transcriptHashB64
      if (credential.kind === 'token') {
        // Why opt-in: relay token auth stays the exact key set the host accepts there.
        const capabilities = args.v2TokenCapabilities ? options?.clientCapabilities : undefined
        return session.sealText(
          serializeJson({
            ...pairedE2EEV2TokenAuth(transcriptHashB64, credential.deviceToken),
            ...(capabilities ? { clientCapabilities: capabilities } : {})
          })
        )
      }
      const signature = await credential.sign(
        encodeDeviceProofMessage('auth', args.primitives.decodeBase64(transcriptHashB64))
      )
      return session.sealText(
        serializeJson({
          type: 'e2ee_auth',
          v: 2,
          transcriptHashB64,
          deviceId: credential.deviceId,
          deviceProofB64: args.primitives.encodeBase64(signature),
          ...(options?.clientCapabilities ? { clientCapabilities: options.clientCapabilities } : {})
        })
      )
    },
    classifyAuthReply: (plaintext) => {
      const reply = parseJsonOrUndefined(plaintext, parseJson)
      return reply === undefined
        ? { kind: 'invalid' }
        : classifyPairedE2EEV2AuthReply(reply, session.transcriptHashB64)
    }
  }
}

export function pairedE2EEV2TokenAuth(
  transcriptHashB64: string,
  deviceToken: string
): { type: 'e2ee_auth'; v: 2; transcriptHashB64: string; deviceToken: string } {
  return { type: 'e2ee_auth', v: 2, transcriptHashB64, deviceToken }
}

export function classifyPairedE2EEV2AuthReply(
  reply: unknown,
  transcriptHashB64: string
): PairedE2EEAuthReply {
  // Why exact: the authenticated reply must echo this session's transcript.
  const authenticated =
    isRecord(reply) &&
    Object.keys(reply).sort().join(',') === 'transcriptHashB64,type,v' &&
    reply.type === 'e2ee_authenticated' &&
    reply.v === 2 &&
    reply.transcriptHashB64 === transcriptHashB64
  return authenticated ? { kind: 'authenticated' } : rejectedReply(reply)
}

function isReadyWithoutForwardSecrecy(ready: unknown): boolean {
  return (
    isRecord(ready) &&
    ready.type === 'e2ee_ready' &&
    (ready.v !== 2 || typeof ready.desktopEphemeralPublicKeyB64 !== 'string')
  )
}

function parseJsonOrUndefined(text: string, parseJson: (text: string) => unknown): unknown {
  try {
    return parseJson(text)
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readStringField(value: unknown, field: string): string | null {
  if (!isRecord(value)) {
    return null
  }
  const fieldValue = value[field]
  return typeof fieldValue === 'string' ? fieldValue : null
}

function rejectedReply(reply: unknown): PairedE2EEAuthReply {
  const errorDeviceId = isRecord(reply) ? readStringField(reply.error, 'deviceId') : null
  return {
    kind: 'rejected',
    type: readStringField(reply, 'type'),
    errorCode: readErrorCode(reply),
    ...(errorDeviceId ? { errorDeviceId } : {})
  }
}

function readErrorCode(value: unknown): string | null {
  return isRecord(value) ? readStringField(value.error, 'code') : null
}
