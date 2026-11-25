import nacl from 'tweetnacl'
import { describe, expect, it } from 'vitest'
import {
  encodeDeviceProofMessage,
  isDevicePublicKeyB64,
  verifyDeviceProof
} from './device-key-proof'

const hash = new Uint8Array(32).fill(7)
const hashB64 = Buffer.from(hash).toString('base64')
const key = nacl.sign.keyPair()
const devicePublicKeyB64 = Buffer.from(key.publicKey).toString('base64')

function proof(purpose: 'auth' | 'register', transcript = hash): string {
  return Buffer.from(
    nacl.sign.detached(encodeDeviceProofMessage(purpose, transcript), key.secretKey)
  ).toString('base64')
}

describe('device key proof', () => {
  it('domain-separates the purpose and binds the transcript', () => {
    const message = new TextDecoder().decode(encodeDeviceProofMessage('auth', hash).slice(0, 26))
    expect(message).toBe('orca-device-proof/v1\0auth\0')
    expect(
      verifyDeviceProof({
        devicePublicKeyB64,
        deviceProofB64: proof('auth'),
        purpose: 'auth',
        transcriptHashB64: hashB64
      })
    ).toBe(true)
    expect(
      verifyDeviceProof({
        devicePublicKeyB64,
        deviceProofB64: proof('register'),
        purpose: 'auth',
        transcriptHashB64: hashB64
      })
    ).toBe(false)
    expect(
      verifyDeviceProof({
        devicePublicKeyB64,
        deviceProofB64: proof('auth', new Uint8Array(32).fill(8)),
        purpose: 'auth',
        transcriptHashB64: hashB64
      })
    ).toBe(false)
    const otherKey = Buffer.from(nacl.sign.keyPair().publicKey).toString('base64')
    expect(
      verifyDeviceProof({
        devicePublicKeyB64: otherKey,
        deviceProofB64: proof('auth'),
        purpose: 'auth',
        transcriptHashB64: hashB64
      })
    ).toBe(false)
  })

  it('refuses a low-order key, under which a proof needs no secret', () => {
    // The identity point, and the signature (R = identity, S = 0) that verifies under it for any message.
    const identityKeyB64 = 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
    const forgedProofB64 =
      'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=='

    expect(
      verifyDeviceProof({
        devicePublicKeyB64: identityKeyB64,
        deviceProofB64: forgedProofB64,
        purpose: 'auth',
        transcriptHashB64: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc='
      })
    ).toBe(false)
    expect(isDevicePublicKeyB64(identityKeyB64)).toBe(false)
    // An order-8 point.
    expect(isDevicePublicKeyB64('JuiVj8KyJ7BFw/SJ8u+Y8NXfrAXTxjM5sTgCiG1T/AU=')).toBe(false)
    expect(isDevicePublicKeyB64(devicePublicKeyB64)).toBe(true)
  })
})
