import { afterEach, describe, expect, it } from 'vitest'
import {
  newHostKeypair,
  signHostSession,
  startRelayUnderTest,
  type RelayUnderTest
} from './relay-attack-surface'

let relay: RelayUnderTest | null = null

afterEach(async () => {
  await relay?.dispose()
  relay = null
})

// SR-06: the session secret is the only gate on the push API, so a guessable one must not boot.
describe('HOST_SESSION_SECRET validation', () => {
  it.each([
    ['empty', ''],
    ['short', 'changeme'],
    ['long but repetitive', 'a'.repeat(64)]
  ])('serves nothing with an %s secret, even to a session forged with it', async (_name, secret) => {
    relay = await startRelayUnderTest({
      enrolled: [newHostKeypair()],
      vars: { HOST_SESSION_SECRET: secret }
    })

    const health = await fetch(`${relay.origin}/health`)
    const devices = await fetch(`${relay.origin}/v1/devices`, {
      headers: { authorization: `Bearer ${signHostSession(secret, 'AbCdEf0123_-xyZ9')}` }
    })

    expect(health.status).toBe(503)
    expect(await health.json()).toEqual({ error: 'relay_misconfigured' })
    expect(devices.status).toBe(503)
  })
})
