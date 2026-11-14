import { afterEach, describe, expect, it } from 'vitest'
import {
  enrolHost,
  newHostKeypair,
  openPhone,
  pairPhone,
  postJson,
  relayAuthFrame,
  startRelayUnderTest,
  type RelayUnderTest
} from './relay-attack-surface'

let relay: RelayUnderTest | null = null
let stop: (() => Promise<void>)[] = []

async function liveHost(vars: Record<string, string> = {}) {
  const keys = newHostKeypair()
  relay = await startRelayUnderTest({ enrolled: [keys], vars })
  const host = await enrolHost(relay.origin, keys)
  stop.push(host.stop)
  return { origin: relay.origin, host }
}

afterEach(async () => {
  for (const end of stop) {
    await end()
  }
  stop = []
  await relay?.dispose()
  relay = null
})

describe('phone sockets', () => {
  // F6, A1-U2: one admitted upgrade buys one guess, not as many as fit in the socket.
  it('judges only the first credential frame a socket sends', async () => {
    const { origin, host } = await liveHost()
    const invite = await host.client.createInvite('phone-1')

    const guesser = openPhone(origin, host.relayHostId, [
      relayAuthFrame('not-the-credential'),
      relayAuthFrame(invite.inviteToken)
    ])

    expect(await guesser.closed).toBe(4401)
    expect(guesser.hello()?.ok).not.toBe(true)
    expect(host.opens).toEqual([])
  })

  // A1-07: a timeout must not read as "your credential was refused", which makes a phone forget it.
  it('closes a socket that never sends its credential with 4408, not 4401', async () => {
    const { origin, host } = await liveHost()

    const silent = openPhone(origin, host.relayHostId, [])

    expect(await silent.closed).toBe(4408)
  })

  // F5: an idle splice does not hold a seat and a Durable Object open forever.
  it('closes a splice that carries no frame for the idle timeout', async () => {
    const { origin, host } = await liveHost({ SPLICE_IDLE_TIMEOUT_MS: '1500' })

    const { phone } = await pairPhone(origin, host, 'phone-1')

    expect(await phone.closed).toBe(4408)
  })

  // F4, SR-05: revoking a device ends the session it has, and its credential.
  it('cuts the live splice of a revoked device and forgets its credential', async () => {
    const { origin, host } = await liveHost()
    const { resumeToken, phone } = await pairPhone(origin, host, 'phone-1')
    const other = await pairPhone(origin, host, 'phone-2')

    await host.client.revokeDevice('phone-1')

    expect(await phone.closed).toBe(4401)
    expect(other.phone.closeCode()).toBeNull()
    const again = openPhone(origin, host.relayHostId, [relayAuthFrame(resumeToken)])
    expect(await again.closed).toBe(4401)
    const resolved = await postJson(`${origin}/v1/resolve`, {
      v: 1,
      relayHostId: host.relayHostId,
      resumeToken
    })
    expect(resolved.status).toBe(401)
    other.phone.socket.terminate()
  })
})
