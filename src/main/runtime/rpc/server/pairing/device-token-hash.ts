import { createHash, timingSafeEqual } from 'node:crypto'

const DEVICE_TOKEN_HASH_PATTERN = /^[0-9a-f]{64}$/

/** What the registry keeps of a used bearer: a file read must not yield a working credential. */
export function hashDeviceToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function isDeviceTokenHash(value: unknown): value is string {
  return typeof value === 'string' && DEVICE_TOKEN_HASH_PATTERN.test(value)
}

export function sameDeviceTokenHash(stored: string | undefined, presented: string): boolean {
  if (stored === undefined) {
    return false
  }
  const a = Buffer.from(stored)
  const b = Buffer.from(presented)
  return a.length === b.length && timingSafeEqual(a, b)
}
