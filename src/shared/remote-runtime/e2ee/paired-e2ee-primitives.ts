import type { SecretboxOpen, SecretboxSeal } from './mobile-e2ee-v2-framing'

// Inject platform adapters for Node, browser and Hermes NaCl/base64 differences, size limits and Buffer availability.
export type PairedE2EEKeyPair = { publicKey: Uint8Array; secretKey: Uint8Array }

export type PairedE2EEV2KeySchedule = {
  mobileToDesktopKey: Uint8Array
  desktopToMobileKey: Uint8Array
  sessionId: Uint8Array
  transcriptHash: Uint8Array
}

export type PairedE2EEPrimitives = {
  generateKeyPair: () => PairedE2EEKeyPair
  // Raw scalar multiplication: the session rejects a degenerate output before any key is derived.
  x25519: (ourSecretKey: Uint8Array, peerPublicKey: Uint8Array) => Uint8Array
  randomBytes: (length: number) => Uint8Array
  encodeBase64: (bytes: Uint8Array) => string
  // Throws on input the platform decoder rejects.
  decodeBase64: (value: string) => Uint8Array
  // Throws on anything but a 32-byte key that is not a low-order point.
  publicKeyFromBase64: (value: string) => Uint8Array
  publicKeyToBase64: (key: Uint8Array) => string
  // Phone-only native overrides avoid Hermes’ ~100x slower JS; absent overrides use tweetnacl, re-encoding and TextDecoder.
  openSecretbox?: SecretboxOpen
  sealSecretbox?: SecretboxSeal
  // Null for anything but canonical padded base64.
  decodeCanonicalBase64?: (value: string) => Uint8Array | null
  decodeUtf8?: (bytes: Uint8Array) => string
  // Why injected: Node uses node:crypto, so the CLI's unbundled runtime needs no extra package.
  deriveV2KeySchedule: (args: {
    staticSharedSecret: Uint8Array
    ephemeralSharedSecret: Uint8Array
    transcript: Uint8Array
    clientNonce: Uint8Array
    desktopNonce: Uint8Array
  }) => PairedE2EEV2KeySchedule
}
