import nacl from 'tweetnacl'
import * as ExpoCrypto from 'expo-crypto'
import { isLowOrderX25519PublicKey } from '../../../../src/shared/remote-runtime/e2ee/x25519-low-order-points'
import { decodeBase64Bytes, encodeBase64Bytes } from './base64-byte-codec'

// Provide native secure randomness for Hermes environments without crypto.getRandomValues.
nacl.setPRNG((_x: Uint8Array, n: number) => {
  const bytes = ExpoCrypto.getRandomBytes(n)
  _x.set(bytes)
})

// Normalize Hermes/native typed-array prototypes for tweetnacl’s instanceof checks.
function u8(x: Uint8Array): Uint8Array {
  return new Uint8Array(x)
}

export function generateKeyPair(): { publicKey: Uint8Array; secretKey: Uint8Array } {
  const kp = nacl.box.keyPair()
  return { publicKey: u8(kp.publicKey), secretKey: u8(kp.secretKey) }
}

export function randomBytes(length: number): Uint8Array {
  return u8(nacl.randomBytes(length))
}

export function x25519(ourSecretKey: Uint8Array, peerPublicKey: Uint8Array): Uint8Array {
  return u8(nacl.scalarMult(u8(ourSecretKey), u8(peerPublicKey)))
}

export function publicKeyFromBase64(b64: string): Uint8Array {
  const key = decodeBase64Bytes(b64)
  if (key.length !== 32) {
    throw new Error(
      `Invalid public key: expected 32 bytes, got ${key.length} from "${b64.slice(0, 20)}..."`
    )
  }
  if (isLowOrderX25519PublicKey(key)) {
    throw new Error('Invalid public key: low-order point')
  }
  return key
}

export function publicKeyToBase64(key: Uint8Array): string {
  return encodeBase64Bytes(key)
}
