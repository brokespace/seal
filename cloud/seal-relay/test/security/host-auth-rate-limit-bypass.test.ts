import { afterAll, beforeAll, expect, it } from 'vitest'
import { describePoc } from './poc-opt-in'
import {
  newHostKeypair,
  postJson,
  startRelayUnderTest,
  type RelayUnderTest
} from './relay-attack-surface'

let relay: RelayUnderTest

// Each accepted challenge creates a SealPushHost Durable Object and writes a row to its SQLite storage.
async function challengeAs(sourceAddress: string): Promise<number> {
  const response = await postJson(
    `${relay.origin}/v1/host/challenge`,
    { v: 1, hostPublicKeyB64: newHostKeypair().publicKeyB64 },
    // Cloudflare sets this header to the real client address; here it stands in for that address.
    { 'cf-connecting-ip': sourceAddress }
  )
  return response.status
}

describePoc('PoC SR-02: unauthenticated callers create durable relay state without a real limit', () => {
  beforeAll(async () => {
    relay = await startRelayUnderTest()
  })
  afterAll(async () => {
    await relay?.dispose()
  })

  it('one address is held to 30 challenges a minute', async () => {
    const statuses: number[] = []
    for (let i = 0; i < 40; i++) {
      statuses.push(await challengeAs('2001:db8:aaaa:1::1'))
    }
    expect(statuses.filter((status) => status === 200)).toHaveLength(30)
    expect(statuses.filter((status) => status === 429)).toHaveLength(10)
  })

  it('rotating addresses inside a single IPv6 /64 is never limited', async () => {
    const statuses: number[] = []
    for (let i = 0; i < 120; i++) {
      statuses.push(await challengeAs(`2001:db8:bbbb:1::${(i + 1).toString(16)}`))
    }
    expect(statuses.every((status) => status === 200)).toBe(true)
  })
})
