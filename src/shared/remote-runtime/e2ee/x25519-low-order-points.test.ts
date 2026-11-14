import nacl from 'tweetnacl'
import { describe, expect, it, vi } from 'vitest'
import { isLowOrderEd25519PublicKey } from './ed25519-low-order-points'
import {
  contributoryX25519SharedSecret,
  isAllZeroX25519SharedSecret,
  isLowOrderX25519PublicKey
} from './x25519-low-order-points'

const hex = (value: string): Uint8Array => new Uint8Array(Buffer.from(value, 'hex'))

// RFC 7748 §6.1 Alice public key: a full-order point.
const VALID_X25519_KEY = hex('8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a')
// RFC 8032 §7.1 test 1 public key.
const VALID_ED25519_KEY = hex('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a')

describe('low-order Curve25519 public keys', () => {
  it('flags every low-order X25519 encoding, with or without the ignored top bit', () => {
    const lowOrder = [
      '0000000000000000000000000000000000000000000000000000000000000000',
      '0100000000000000000000000000000000000000000000000000000000000000',
      'e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b800',
      '5f9c95bca3508c24b1d0b1559c83ef5b04445cc4581c8e86d8224eddd09f1157',
      'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
      'edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
      'eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
      '0000000000000000000000000000000000000000000000000000000000000080',
      'e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b880',
      'edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
    ]
    for (const encoding of lowOrder) {
      expect(isLowOrderX25519PublicKey(hex(encoding)), encoding).toBe(true)
    }
    expect(isLowOrderX25519PublicKey(VALID_X25519_KEY)).toBe(false)
  })

  it('never runs X25519 against a low-order peer key, and refuses an all-zero output', () => {
    const secretKey = nacl.box.keyPair().secretKey
    const x25519 = vi.fn(nacl.scalarMult)
    expect(contributoryX25519SharedSecret(x25519, secretKey, new Uint8Array(32))).toBeNull()
    expect(x25519).not.toHaveBeenCalled()

    expect(
      contributoryX25519SharedSecret(() => new Uint8Array(32), secretKey, VALID_X25519_KEY)
    ).toBeNull()
    expect(isAllZeroX25519SharedSecret(new Uint8Array(32))).toBe(true)

    const shared = contributoryX25519SharedSecret(x25519, secretKey, VALID_X25519_KEY)
    expect(shared).toEqual(nacl.scalarMult(secretKey, VALID_X25519_KEY))
  })

  it('flags Ed25519 keys of order 1, 2, 4 and 8 under either sign bit', () => {
    const lowOrder = [
      '0100000000000000000000000000000000000000000000000000000000000000',
      'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
      '0000000000000000000000000000000000000000000000000000000000000000',
      '0000000000000000000000000000000000000000000000000000000000000080',
      '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05',
      '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85',
      'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a',
      'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa'
    ]
    for (const encoding of lowOrder) {
      expect(isLowOrderEd25519PublicKey(hex(encoding)), encoding).toBe(true)
    }
    expect(isLowOrderEd25519PublicKey(VALID_ED25519_KEY)).toBe(false)
  })
})
