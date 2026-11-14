// Dependency-free so the relay Worker, the hosts and every client share one list.

const KEY_BYTES = 32

// Encodings of 0, 1 and p-1, and the non-canonical p and p+1; both Curve25519 forms share them.
export const CURVE25519_SHARED_LOW_ORDER_ENCODINGS = [
  '0000000000000000000000000000000000000000000000000000000000000000',
  '0100000000000000000000000000000000000000000000000000000000000000',
  'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
  'edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
  'eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f'
] as const

const X25519_LOW_ORDER_POINTS = decodeLowOrderEncodings([
  ...CURVE25519_SHARED_LOW_ORDER_ENCODINGS,
  // The two order-8 u-coordinates.
  'e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b800',
  '5f9c95bca3508c24b1d0b1559c83ef5b04445cc4581c8e86d8224eddd09f1157'
])

export function decodeLowOrderEncodings(hexEncodings: readonly string[]): Uint8Array[] {
  return hexEncodings.map((hex) => {
    const bytes = new Uint8Array(KEY_BYTES)
    for (let index = 0; index < KEY_BYTES; index++) {
      bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
    }
    return bytes
  })
}

export function matchesLowOrderEncoding(bytes: Uint8Array, points: readonly Uint8Array[]): boolean {
  if (bytes.length !== KEY_BYTES) {
    return false
  }
  return points.some((point) => {
    for (let index = 0; index < KEY_BYTES - 1; index++) {
      if (bytes[index] !== point[index]) {
        return false
      }
    }
    // Why masked: decoders ignore the top bit, so it must not carry a listed point past the check.
    return (bytes[KEY_BYTES - 1]! & 0x7f) === point[KEY_BYTES - 1]
  })
}

/** True for a Curve25519 public key whose X25519 output is the same for every secret key. */
export function isLowOrderX25519PublicKey(bytes: Uint8Array): boolean {
  return matchesLowOrderEncoding(bytes, X25519_LOW_ORDER_POINTS)
}

/** True for the all-zero X25519 output that only a low-order peer key produces. */
export function isAllZeroX25519SharedSecret(sharedSecret: Uint8Array): boolean {
  let accumulated = 0
  for (const byte of sharedSecret) {
    accumulated |= byte
  }
  return accumulated === 0
}

/** The X25519 output for a peer key, or null when that key or the output is degenerate. */
export function contributoryX25519SharedSecret(
  x25519: (ourSecretKey: Uint8Array, peerPublicKey: Uint8Array) => Uint8Array,
  ourSecretKey: Uint8Array,
  peerPublicKey: Uint8Array
): Uint8Array | null {
  if (isLowOrderX25519PublicKey(peerPublicKey)) {
    return null
  }
  const sharedSecret = x25519(ourSecretKey, peerPublicKey)
  return isAllZeroX25519SharedSecret(sharedSecret) ? null : sharedSecret
}
