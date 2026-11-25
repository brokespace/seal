import nacl from 'tweetnacl'
import { decodeBase64Bytes } from '@/lib/base64-bytes'
import { isLowOrderX25519PublicKey } from '../../../shared/remote-runtime/e2ee/x25519-low-order-points'

if (globalThis.crypto?.getRandomValues) {
  nacl.setPRNG((bytes, count) => {
    globalThis.crypto.getRandomValues(bytes.subarray(0, count) as Uint8Array<ArrayBuffer>)
  })
}

export function generateKeyPair(): nacl.BoxKeyPair {
  return nacl.box.keyPair()
}

export function x25519(ourSecretKey: Uint8Array, peerPublicKey: Uint8Array): Uint8Array {
  return nacl.scalarMult(ourSecretKey, peerPublicKey)
}

export function publicKeyFromBase64(b64: string): Uint8Array {
  const key = decodeBase64Bytes(b64)
  if (key.length !== 32) {
    throw new Error(`Invalid public key: expected 32 bytes, got ${key.length}`)
  }
  if (isLowOrderX25519PublicKey(key)) {
    throw new Error('Invalid public key: low-order point')
  }
  return key
}

export function publicKeyToBase64(key: Uint8Array): string {
  return bytesToBase64(key)
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return window.btoa(binary)
}
