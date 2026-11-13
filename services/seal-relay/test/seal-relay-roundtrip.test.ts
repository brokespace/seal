import { randomBytes, webcrypto } from 'node:crypto'
import nacl from 'tweetnacl'
import WebSocket from 'ws'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { RelayControlClient } from '../../../src/main/runtime/mobile-cloud-relay/control-channel/relay-control-client'
import {
  createSealRelayContextReader,
  sealRelayEndpointConfig,
  sealRelayIdentity
} from '../../../src/main/runtime/mobile-cloud-relay/authentication/seal-relay-host-auth'
import {
  deriveRelayHostId,
  exchangeRelayAuthorization,
  requestRelayAssignment
} from '../../../src/main/runtime/mobile-cloud-relay/director/relay-http-client'
import { RelayAssignRateGate } from '../../../src/main/runtime/mobile-cloud-relay/director/relay-assign-rate-gate'
import type { E2EEKeypair } from '../../../src/main/runtime/rpc/server/pairing/e2ee-keypair'
import { CloudRelayTransport } from '../../../src/main/runtime/rpc/transports/relay-transport'
import { PushGatewayClient } from '../../../src/main/runtime/push/push-gateway-client'
import {
  generateTestSecrets,
  startFakeProviders,
  startSealRelay,
  waitFor
} from './seal-relay-harness'

type Keypair = E2EEKeypair

function newHostKeypair(): Keypair {
  const box = nacl.box.keyPair()
  return { ...box, publicKeyB64: Buffer.from(box.publicKey).toString('base64') }
}

let relay: Awaited<ReturnType<typeof startSealRelay>>
let providers: Awaited<ReturnType<typeof startFakeProviders>>
let apnsPublicKey: webcrypto.CryptoKey

beforeAll(async () => {
  providers = await startFakeProviders()
  const generated = await generateTestSecrets()
  apnsPublicKey = generated.apnsPublicKey
  relay = await startSealRelay({
    ...generated.secrets,
    PUSH_PROVIDER_ORIGIN_OVERRIDE: providers.origin
  })
})

afterAll(async () => {
  await relay?.dispose()
  await providers?.close()
})

async function goLive(keypair: Keypair) {
  const relayHostId = deriveRelayHostId(keypair.publicKey)
  const context = await createSealRelayContextReader({ relayOrigin: relay.origin, keypair })()
  const endpoints = sealRelayEndpointConfig(relay.origin)
  const { relayToken } = await exchangeRelayAuthorization({
    endpoint: endpoints.relayTokenEndpoint,
    accessToken: context!.accessToken,
    keypair: keypair
  })
  const assignment = await requestRelayAssignment({
    directorUrl: endpoints.relayDirectorUrl,
    relayToken,
    relayHostId,
    // Each simulated desktop launch starts unpaced.
    assignRateGate: new RelayAssignRateGate()
  })
  const opens: { connId: string }[] = []
  let transport: CloudRelayTransport | null = null
  const client = new RelayControlClient({
    cellUrl: assignment.cellUrl,
    relayJwt: relayToken,
    relayHostId,
    assignmentEpoch: assignment.assignmentEpoch,
    identity: sealRelayIdentity(relayHostId),
    keypair: keypair,
    appVersion: 'seal-test',
    onConnectionOpen: (open) => {
      opens.push(open)
      void transport?.openConnection(open)
    },
    onDrain: () => {},
    onClose: () => {},
    createSocket: (url, token) =>
      new WebSocket(url, {
        headers: { authorization: `Bearer ${token}` },
        perMessageDeflate: false
      })
  })
  const ack = await client.connect()
  transport = new CloudRelayTransport({
    cellUrl: assignment.cellUrl,
    relayHostId,
    generation: ack.generation
  })
  return { client, transport, opens, relayHostId, assignment }
}

describe('Seal relay', () => {
  it('carries end-to-end encrypted frames between a desktop and a phone paired by invite', async () => {
    const hostKeys = newHostKeypair()
    const first = await goLive(hostKeys)
    expect(first.assignment.cellUrl).toBe(relay.origin)
    first.client.closeNow()
    // A relaunched desktop keeps its placement.
    const live = await goLive(hostKeys)
    expect(live.assignment.assignmentEpoch).toBe(first.assignment.assignmentEpoch)
    // The desktop only ever sees ciphertext from the relay and answers in ciphertext.
    live.transport.onMessage((message, reply) => {
      if (typeof message === 'string') {
        return
      }
      const phonePublicKey = message.slice(0, 32)
      const nonce = message.slice(32, 56)
      const opened = nacl.box.open(message.slice(56), nonce, phonePublicKey, hostKeys.secretKey)
      if (!opened) {
        return
      }
      const answerNonce = randomBytes(24)
      const answer = nacl.box(
        Buffer.from(`ack:${Buffer.from(opened).toString()}`),
        answerNonce,
        phonePublicKey,
        hostKeys.secretKey
      )
      reply(Buffer.concat([answerNonce, answer]))
    })
    const invite = await live.client.createInvite('phone-1')
    const resolved = await fetch(`${relay.origin}/v1/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ v: 1, relayHostId: live.relayHostId, resumeToken: 'opaque' })
    })
    expect(await resolved.json()).toMatchObject({
      v: 1,
      cellUrl: relay.origin,
      assignmentEpoch: live.assignment.assignmentEpoch
    })

    const phoneKeys = nacl.box.keyPair()
    const phone = new WebSocket(
      `${relay.origin.replace(/^http/, 'ws')}/v1/connect/${live.relayHostId}`,
      { perMessageDeflate: false }
    )
    const received: Buffer[] = []
    let hello: { ok?: boolean; credentialKind?: string } | null = null
    phone.on('open', () =>
      phone.send(
        JSON.stringify({
          type: 'relay-auth',
          v: 1,
          mode: 'connect',
          credential: invite.inviteToken
        })
      )
    )
    phone.on('message', (raw: Buffer, isBinary: boolean) => {
      if (!isBinary && hello === null) {
        hello = JSON.parse(raw.toString())
      } else {
        received.push(raw)
      }
    })
    expect(await waitFor(() => hello !== null && live.opens.length > 0)).toBe(true)
    expect(hello).toMatchObject({ ok: true, credentialKind: 'invite' })

    const nonce = randomBytes(24)
    phone.send(
      Buffer.concat([
        phoneKeys.publicKey,
        nonce,
        nacl.box(Buffer.from('hello seal'), nonce, hostKeys.publicKey, phoneKeys.secretKey)
      ])
    )
    expect(await waitFor(() => received.length > 0)).toBe(true)
    const frame = new Uint8Array(received[0])
    const plaintext = nacl.box.open(
      frame.slice(24),
      frame.slice(0, 24),
      hostKeys.publicKey,
      phoneKeys.secretKey
    )
    expect(Buffer.from(plaintext!).toString()).toBe('ack:hello seal')

    phone.close()
    live.client.closeNow()
    await live.transport.stop()
  })

  it('mints relay tokens only for the key the host session proved', async () => {
    const owner = newHostKeypair()
    const context = await createSealRelayContextReader({
      relayOrigin: relay.origin,
      keypair: owner
    })()
    const other = newHostKeypair()
    const response = await fetch(`${relay.origin}/v1/host/relay-token`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${context!.accessToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        relayHostId: deriveRelayHostId(other.publicKey),
        hostPublicKeyB64: other.publicKeyB64
      })
    })
    expect(response.status).toBe(403)
  })

  it('keeps the shared edge admin routes unreachable', async () => {
    const response = await fetch(`${relay.origin}/__admin/assign`, { method: 'POST', body: '{}' })
    expect(response.status).toBe(404)
  })
})

function base64UrlDecode(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64url'))
}

describe('Seal push', () => {
  it('delivers to APNs with the Seal topic and a provider token signed by the .p8 key, and retires dead tokens', async () => {
    const host = newHostKeypair()
    const push = new PushGatewayClient({ gatewayUrl: relay.origin, keypair: host })
    const token = randomBytes(32).toString('hex')
    const registered = await push.registerDevice({
      deviceId: 'iphone-1',
      platform: 'ios',
      token,
      apnsEnvironment: 'sandbox'
    })
    if (!registered.ok) {
      throw new Error(`register failed: ${registered.reason}`)
    }

    providers.respond(() => ({ status: 200 }))
    const notification = {
      notificationSeq: 1,
      notificationEpoch: 'epoch-1',
      source: 'agent-task-complete' as const,
      agentState: 'finished' as const,
      title: 'Claude finished',
      body: 'seal/mobile is ready'
    }
    const sent = await push.send({ registrationIds: [registered.registrationId], notification })
    expect(sent).toEqual({
      ok: true,
      results: [{ registrationId: registered.registrationId, status: 'queued' }]
    })

    const apns = providers.requests.at(-1)!
    expect(apns.path).toBe(`/api.sandbox.push.apple.com/3/device/${token}`)
    expect(apns.headers['apns-topic']).toBe('com.brokespace.seal.mobile')
    expect(JSON.parse(apns.body).aps.alert).toEqual({
      title: 'Claude finished',
      body: 'seal/mobile is ready'
    })
    const [header, payload, signature] = String(apns.headers.authorization)
      .replace(/^bearer /, '')
      .split('.')
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({
      alg: 'ES256',
      kid: 'KEYID12345'
    })
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString()).iss).toBe('TEAMID1234')
    const verified = await webcrypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      apnsPublicKey,
      base64UrlDecode(signature),
      new TextEncoder().encode(`${header}.${payload}`)
    )
    expect(verified).toBe(true)

    providers.respond(() => ({ status: 410, body: JSON.stringify({ reason: 'Unregistered' }) }))
    const dead = await push.send({
      registrationIds: [registered.registrationId],
      notification: { ...notification, notificationSeq: 2 }
    })
    expect(dead).toEqual({
      ok: true,
      results: [{ registrationId: registered.registrationId, status: 'dead' }]
    })
    const requestsBefore = providers.requests.length
    await push.send({
      registrationIds: [registered.registrationId],
      notification: { ...notification, notificationSeq: 3 }
    })
    expect(providers.requests.length).toBe(requestsBefore)
  })

  it('delivers to FCM with a service-account access token', async () => {
    const push = new PushGatewayClient({
      gatewayUrl: relay.origin,
      keypair: newHostKeypair()
    })
    const token = `fcm:${randomBytes(24).toString('base64url')}`
    const registered = await push.registerDevice({
      deviceId: 'pixel-1',
      platform: 'android',
      token
    })
    if (!registered.ok) {
      throw new Error('register failed')
    }
    providers.respond((request) =>
      request.path.startsWith('/oauth2.googleapis.com/token')
        ? { status: 200, body: JSON.stringify({ access_token: 'google-access', expires_in: 3600 }) }
        : { status: 200, body: '{}' }
    )
    const sent = await push.send({
      registrationIds: [registered.registrationId],
      notification: {
        notificationSeq: 1,
        notificationEpoch: 'e',
        source: 'terminal-bell',
        agentState: null,
        title: 'Bell',
        body: 'ding'
      }
    })
    expect(sent).toEqual({
      ok: true,
      results: [{ registrationId: registered.registrationId, status: 'queued' }]
    })
    const fcm = providers.requests.at(-1)!
    expect(fcm.path).toBe('/fcm.googleapis.com/v1/projects/seal-test/messages:send')
    expect(fcm.headers.authorization).toBe('Bearer google-access')
    expect(JSON.parse(fcm.body).message).toMatchObject({
      token,
      data: { title: 'Bell', message: 'ding' }
    })
  })

  it('scopes devices to the host key that registered them', async () => {
    const owner = new PushGatewayClient({
      gatewayUrl: relay.origin,
      keypair: newHostKeypair()
    })
    const registered = await owner.registerDevice({
      deviceId: 'iphone-2',
      platform: 'ios',
      token: 'ab'.repeat(32),
      apnsEnvironment: 'production'
    })
    if (!registered.ok) {
      throw new Error('register failed')
    }
    const stranger = new PushGatewayClient({
      gatewayUrl: relay.origin,
      keypair: newHostKeypair()
    })
    const before = providers.requests.length
    const result = await stranger.send({
      registrationIds: [registered.registrationId],
      notification: {
        notificationSeq: 1,
        notificationEpoch: 'e',
        source: 'terminal-bell',
        agentState: null,
        title: 't',
        body: 'b'
      }
    })
    expect(result).toEqual({
      ok: true,
      results: [{ registrationId: registered.registrationId, status: 'dead' }]
    })
    expect(providers.requests.length).toBe(before)
  })
})
