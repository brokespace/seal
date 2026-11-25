import { sha256 } from '@noble/hashes/sha256'

const RELAY_HOST_ID_LENGTH = 16
const X25519_PUBLIC_KEY_BYTES = 32

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** The relay binds a host to this id: 16 base64url characters of SHA-256 over its X25519 public key. */
export function deriveRelayHostId(publicKey: Uint8Array): string {
  return encodeBase64Url(sha256(publicKey)).slice(0, RELAY_HOST_ID_LENGTH)
}

/** Null when the text is not base64 of exactly 32 bytes, so a malformed key never yields an id. */
export function deriveRelayHostIdFromPublicKeyB64(publicKeyB64: string): string | null {
  let binary: string
  try {
    binary = atob(publicKeyB64)
  } catch {
    return null
  }
  if (binary.length !== X25519_PUBLIC_KEY_BYTES) {
    return null
  }
  const publicKey = new Uint8Array(X25519_PUBLIC_KEY_BYTES)
  for (let index = 0; index < X25519_PUBLIC_KEY_BYTES; index++) {
    publicKey[index] = binary.charCodeAt(index)
  }
  return deriveRelayHostId(publicKey)
}

/** Groups the id in fours so two people can compare it by eye. */
export function formatRelayHostFingerprint(relayHostId: string): string {
  return relayHostId.match(/.{1,4}/g)?.join(' ') ?? relayHostId
}
