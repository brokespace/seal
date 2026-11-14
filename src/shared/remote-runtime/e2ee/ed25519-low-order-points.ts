import {
  CURVE25519_SHARED_LOW_ORDER_ENCODINGS,
  decodeLowOrderEncodings,
  matchesLowOrderEncoding
} from './x25519-low-order-points'

const ED25519_LOW_ORDER_POINTS = decodeLowOrderEncodings([
  ...CURVE25519_SHARED_LOW_ORDER_ENCODINGS,
  // The two order-8 y-coordinates; the masked sign bit covers both x.
  '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05',
  'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a'
])

/** True for an Ed25519 public key of order 1, 2, 4 or 8, which verifies signatures no key holder made. */
export function isLowOrderEd25519PublicKey(bytes: Uint8Array): boolean {
  return matchesLowOrderEncoding(bytes, ED25519_LOW_ORDER_POINTS)
}
