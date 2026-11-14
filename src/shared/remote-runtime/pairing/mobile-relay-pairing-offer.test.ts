import { describe, expect, it } from 'vitest'
import { createMobileRelayPairingFixtures } from '../relay/mobile-relay-pairing-fixtures'
import { createPairingOfferSchema } from './mobile-relay-pairing-offer'

const NOW = 1_800_000_000_000

describe('pairing offer schema', () => {
  it.each(createMobileRelayPairingFixtures(NOW))('$name', ({ payload, expected }) => {
    const result = createPairingOfferSchema(() => NOW).safeParse(payload)

    expect(result.success ? result.data : null).toEqual(expected)
  })
})
