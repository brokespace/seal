// Curve25519 key handling shared by desktop/CLI pairing; kept free of main imports for the CLI.
import nacl from 'tweetnacl'
import { isLowOrderX25519PublicKey } from '../x25519-low-order-points'

export function generateKeyPair(): nacl.BoxKeyPair {
  return nacl.box.keyPair()
}

/** Raw X25519; callers reject a degenerate output with contributoryX25519SharedSecret. */
export function x25519(ourSecretKey: Uint8Array, peerPublicKey: Uint8Array): Uint8Array {
  return nacl.scalarMult(ourSecretKey, peerPublicKey)
}

export function publicKeyFromBase64(b64: string): Uint8Array {
  if (b64.length > 44) {
    throw new Error('Invalid public key: encoded value is too large')
  }
  const key = Uint8Array.from(Buffer.from(b64, 'base64'))
  if (key.length !== 32) {
    throw new Error(`Invalid public key: expected 32 bytes, got ${key.length}`)
  }
  if (isLowOrderX25519PublicKey(key)) {
    throw new Error('Invalid public key: low-order point')
  }
  return key
}

export function publicKeyToBase64(key: Uint8Array): string {
  return Buffer.from(key).toString('base64')
}
