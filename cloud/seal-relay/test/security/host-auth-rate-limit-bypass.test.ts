import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { admitKey } from '../../src/source-rate-limit'
import {
  awayFromLimiterWindowEdge,
  newHostKeypair,
  postJson,
  startRelayUnderTest,
  type RelayUnderTest
} from './relay-attack-surface'

let relay: RelayUnderTest

async function challengeAs(sourceAddress: string): Promise<number> {
  const response = await postJson(
    `${relay.origin}/v1/host/challenge`,
    { v: 1, hostPublicKeyB64: newHostKeypair().publicKeyB64 },
    // Cloudflare sets this header to the real client address; here it stands in for that address.
    { 'cf-connecting-ip': sourceAddress }
  )
  return response.status
}

// SR-02, F3, A1-02: the unauthenticated limiter counts an IPv6 subscriber once, and fails closed.
describe('host-auth rate limit', () => {
  beforeAll(async () => {
    relay = await startRelayUnderTest({ enrolled: [newHostKeypair()] })
  })
  afterAll(async () => {
    await relay?.dispose()
  })

  it('holds every address of one IPv6 /64 to a single budget of 30 a minute', async () => {
    await awayFromLimiterWindowEdge()
    const statuses: number[] = []
    for (let i = 0; i < 40; i++) {
      statuses.push(await challengeAs(`2001:db8:bbbb:1::${(i + 1).toString(16)}`))
    }

    // 403: the callers are strangers. The point is that the 31st is not even looked at.
    expect(statuses.slice(0, 30)).toEqual(Array.from({ length: 30 }, () => 403))
    expect(statuses.slice(30)).toEqual(Array.from({ length: 10 }, () => 429))
    expect(await challengeAs('2001:db8:bbbb:2::1')).toBe(403)
  })

  it('refuses when the limiter binding is missing or broken', async () => {
    const broken = { limit: () => Promise.reject(new Error('limiter down')) } as unknown as RateLimit

    expect(await admitKey(undefined, 'any')).toBe(false)
    expect(await admitKey(broken, 'any')).toBe(false)
  })
})
