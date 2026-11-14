import { randomBytes } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { PushGatewayClient } from '../../../../src/main/runtime/push/push-gateway-client'
import {
  enrolHost,
  hostSessionToken,
  newHostKeypair,
  pairPhone,
  phoneConnect,
  postJson,
  startRelayUnderTest,
  type RelayUnderTest
} from './relay-attack-surface'

let relays: RelayUnderTest[] = []

async function relayWith(options: Parameters<typeof startRelayUnderTest>[0]): Promise<RelayUnderTest> {
  const relay = await startRelayUnderTest(options)
  relays.push(relay)
  return relay
}

afterEach(async () => {
  for (const relay of relays) {
    await relay.dispose()
  }
  relays = []
})

const challenge = (origin: string, hostPublicKeyB64: string): Promise<Response> =>
  postJson(`${origin}/v1/host/challenge`, { v: 1, hostPublicKeyB64 })

// SR-01, SR-04, F9: the relay and its push keys serve only the hosts on the operator's allowlist.
describe('host enrolment allowlist', () => {
  it('gives a stranger with a self-generated key no challenge, no session and no push', async () => {
    const relay = await relayWith({ enrolled: [newHostKeypair()] })
    const stranger = newHostKeypair()

    expect((await challenge(relay.origin, stranger.publicKeyB64)).status).toBe(403)
    const push = new PushGatewayClient({ gatewayUrl: relay.origin, keypair: stranger })
    const registered = await push.registerDevice({
      deviceId: 'stranger-iphone',
      platform: 'ios',
      token: randomBytes(32).toString('hex'),
      apnsEnvironment: 'production'
    })

    expect(registered.ok).toBe(false)
    expect(relay.providers.requests).toEqual([])
  })

  it('enrols nobody when the allowlist is unset', async () => {
    const relay = await relayWith({})

    expect((await challenge(relay.origin, newHostKeypair().publicKeyB64)).status).toBe(403)
  })

  it('refuses every request once the allowlist is malformed', async () => {
    const relay = await relayWith({ vars: { HOST_ALLOWLIST: 'not-a-fingerprint' } })

    const health = await fetch(`${relay.origin}/health`)

    expect(health.status).toBe(503)
    expect(await health.json()).toEqual({ error: 'relay_misconfigured' })
  })

  it('ends the session and relay token of a host taken off the allowlist', async () => {
    const host = newHostKeypair()
    const before = await relayWith({ enrolled: [host] })
    const live = await enrolHost(before.origin, host)
    await live.stop()
    await before.dispose()
    relays = []
    // The same deploy (same signing secrets) with the host removed.
    const after = await relayWith({ secrets: before.secrets, enrolled: [newHostKeypair()] })
    const session = { authorization: `Bearer ${live.sessionToken}` }

    const devices = await fetch(`${after.origin}/v1/devices`, { headers: session })
    const relayToken = await postJson(
      `${after.origin}/v1/host/relay-token`,
      { relayHostId: live.relayHostId, hostPublicKeyB64: host.publicKeyB64 },
      session
    )
    const assign = await postJson(
      `${after.origin}/v1/assign`,
      { v: 1, relayHostId: live.relayHostId },
      { authorization: `Bearer ${live.relayToken}` }
    )

    expect([devices.status, relayToken.status, assign.status]).toEqual([403, 403, 403])
  })

  // SR-08: a low-order key makes the sealed challenge decryptable by anyone.
  it('refuses a low-order host key', async () => {
    const relay = await relayWith({ enrolled: [newHostKeypair()] })

    expect((await challenge(relay.origin, Buffer.alloc(32).toString('base64'))).status).toBe(400)
  })
})

// F8, SR-03: placement is for paired phones, and nobody can ask which hosts exist.
describe('host placement lookup', () => {
  it('answers the same 401 without a live resume credential, and tells a paired phone where its host is', async () => {
    const [hostKeys, neverLive] = [newHostKeypair(), newHostKeypair()]
    const relay = await relayWith({ enrolled: [hostKeys, neverLive] })
    const host = await enrolHost(relay.origin, hostKeys)
    const { resumeToken, phone } = await pairPhone(relay.origin, host, 'phone-1')
    const resolve = (relayHostId: string, token: string): Promise<Response> =>
      postJson(`${relay.origin}/v1/resolve`, { v: 1, relayHostId, resumeToken: token })

    const refused = await Promise.all([
      resolve(host.relayHostId, 'not-a-credential'),
      resolve(await hostIdOf(neverLive), resumeToken),
      resolve(await hostIdOf(newHostKeypair()), resumeToken),
      resolve('AAAAAAAAAAAAAAAA', resumeToken)
    ])
    const found = await resolve(host.relayHostId, resumeToken)

    expect(refused.map((response) => response.status)).toEqual([401, 401, 401, 401])
    expect(await found.json()).toMatchObject({
      v: 1,
      cellUrl: relay.origin,
      assignmentEpoch: host.assignment.assignmentEpoch
    })
    phone.socket.terminate()
    await host.stop()
  })

  it('shows a phone dialing a host that is not enrolled what it shows for an enrolled host that is offline', async () => {
    const offline = newHostKeypair()
    const relay = await relayWith({ enrolled: [offline] })

    const toStranger = await phoneConnect(relay.origin, await hostIdOf(newHostKeypair()), 'x')
    const toOffline = await phoneConnect(relay.origin, await hostIdOf(offline), 'x')

    expect(toStranger.closeCode).toBe(4409)
    expect(toStranger).toEqual(toOffline)
  })
})

async function hostIdOf(keypair: ReturnType<typeof newHostKeypair>): Promise<string> {
  const { deriveRelayHostId } = await import(
    '../../../../src/main/runtime/mobile-cloud-relay/director/relay-http-client'
  )
  return deriveRelayHostId(keypair.publicKey)
}

// SR-05: a stolen token is useful for minutes, not a day.
describe('host credential lifetimes', () => {
  it('mints relay tokens for five minutes and host sessions for an hour', async () => {
    const hostKeys = newHostKeypair()
    const relay = await relayWith({ enrolled: [hostKeys] })
    const session = await hostSessionToken(relay.origin, hostKeys)
    const host = await enrolHost(relay.origin, hostKeys)
    await host.stop()

    const claims = JSON.parse(Buffer.from(host.relayToken.split('.')[1], 'base64url').toString())
    const sessionLifetimeMs = Number(session.split('.')[1]) - Date.now()

    expect(claims.exp - claims.iat).toBe(300)
    expect(sessionLifetimeMs).toBeGreaterThan(59 * 60_000)
    expect(sessionLifetimeMs).toBeLessThanOrEqual(60 * 60_000)
  })
})
