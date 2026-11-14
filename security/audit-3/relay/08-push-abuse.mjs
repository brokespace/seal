#!/usr/bin/env node
// Push endpoint abuse (/v1/devices, /v1/send), as: an external attacker with no key, a stranger
// who tries to enrol their own host key, another enrolled relay host, and the relay operator.
// Deliveries go to the fake APNs started by lib/local-relay.mjs (or the vitest harness), which
// logs each request, so "the phone was notified" is read from that log. Nothing reaches Apple.
import { randomBytes, randomUUID } from 'node:crypto'
import {
  enrolledHostKeys,
  finish,
  freshSourceIp,
  hostChallenge,
  hostSession,
  newHostKeys,
  operatorSecrets,
  providerRequests,
  relayOrigin,
  relayState,
  report,
  setSourceIp,
  signHostSession,
  sleep
} from '../lib/relay-protocol.mjs'

const origin = relayOrigin()
const state = relayState()
const apnsToken = () => randomBytes(32).toString('hex')

async function call(method, path, session, body) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': freshSourceIp(),
      ...(session ? { authorization: `Bearer ${session}` } : {})
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })
  const text = await response.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {}
  return { status: response.status, json }
}
const register = (session, token, deviceId = randomUUID()) =>
  call('POST', '/v1/devices', session, {
    v: 1,
    deviceId,
    platform: 'ios',
    token,
    apnsEnvironment: 'production'
  })
let seq = 0
const notification = (title, body) => ({
  notificationSeq: ++seq,
  notificationEpoch: 'audit',
  source: 'agent-task-complete',
  agentState: 'needs-input',
  title,
  body
})
const send = (session, registrationIds, title, body) =>
  call('POST', '/v1/send', session, {
    v: 1,
    registrationIds,
    notification: notification(title, body)
  })
const deliveriesTo = (token) =>
  providerRequests(state.pushLog).filter((entry) => entry.path.endsWith(`/3/device/${token}`))

// ---- victim: an enrolled host (brian) with his phone registered ----
setSourceIp(freshSourceIp())
const brianKeys = enrolledHostKeys()
const brian = await hostSession(origin, brianKeys)
const brianPhoneToken = apnsToken()
const brianRegistration = (await register(brian.sessionToken, brianPhoneToken)).json.registrationId

// ---- a stranger whose key is not on the allowlist ----
{
  setSourceIp(freshSourceIp())
  const stranger = newHostKeys()
  const challenge = await hostChallenge(origin, stranger)
  let sessionStatus = null
  try {
    await hostSession(origin, stranger)
    sessionStatus = 200
  } catch (error) {
    sessionStatus = Number(/\d+/.exec(String(error.message))?.[0] ?? -1)
  }
  report(
    'stranger key tries to enrol for push (challenge, session)',
    challenge.status === 403 && sessionStatus === 403 ? 'blocked' : 'VULNERABLE',
    { challenge: challenge.status, session: sessionStatus }
  )
}

// ---- external attacker, no key: forged session tokens ----
{
  const expires = Date.now() + 3600_000
  const [, , realSig] = brian.sessionToken.split('.')
  const tokens = {
    'no token': null,
    'random signature': `${brianKeys.hostId}.${expires}.${randomBytes(32).toString('base64url')}`,
    'empty-secret HMAC': signHostSession('', brianKeys.hostId, expires),
    'guessed weak secret': signHostSession('changeme', brianKeys.hostId, expires),
    'real signature, later expiry': `${brianKeys.hostId}.${Number(brian.sessionToken.split('.')[1]) + 1000}.${realSig}`,
    'expired real token': `${brianKeys.hostId}.${Date.now() - 1000}.${realSig}`
  }
  for (const [label, token] of Object.entries(tokens)) {
    const list = await call('GET', '/v1/devices', token)
    const push = await send(token, [brianRegistration], 'x', 'y')
    report(
      `external forged session: ${label}`,
      list.status === 200 || push.status === 200 ? 'VULNERABLE' : 'blocked',
      { devices: list.status, send: push.status }
    )
  }
}

// ---- another enrolled host (mallory) ----
setSourceIp(freshSourceIp())
const mallory = await hostSession(origin, enrolledHostKeys())
{
  // mallory sends to, and tries to delete, brian's registrationId.
  const crossSend = await send(
    mallory.sessionToken,
    [brianRegistration],
    'cross-host',
    'should not arrive'
  )
  const crossDelete = await call('DELETE', `/v1/devices/${brianRegistration}`, mallory.sessionToken)
  const brianStill = (await call('GET', '/v1/devices', brian.sessionToken)).json.devices.length
  report(
    "mallory uses brian's registrationId (send, delete)",
    crossSend.json?.results?.[0]?.status === 'queued' || brianStill === 0
      ? 'VULNERABLE'
      : 'blocked',
    { send: crossSend.json?.results, deleteHttp: crossDelete.status, brianDevicesLeft: brianStill }
  )
  // The registration API takes any APNs token. If mallory learns brian's device token (it is not
  // an authenticator: the operator, Apple, and any earlier host the phone paired with hold it),
  // she registers it under her own host and pushes attacker-chosen text with the relay's APNs key.
  const before = deliveriesTo(brianPhoneToken).length
  const hijack = (await register(mallory.sessionToken, brianPhoneToken)).json.registrationId
  await send(
    mallory.sessionToken,
    [hijack],
    'Seal: session expired',
    'Tap to sign in again at seal-login.example'
  )
  await sleep(300)
  const arrived = deliveriesTo(brianPhoneToken).slice(before)
  report(
    "an enrolled host registers another phone's APNs token and pushes to it",
    arrived.length > 0 ? 'info' : 'blocked',
    {
      reason:
        'the APNs token is not a secret and the relay cannot bind it to a host; enrolment limits this to allowlisted hosts, and the alert is unsigned so a phone can distrust it',
      deliveredAlert: arrived[0] ? JSON.parse(arrived[0].body).aps?.alert : null
    }
  )
}
{
  // Per-host caps: 64 devices and 300 pushes per 15 min. A new enrolled host is a new quota.
  const tokens = []
  let refusedAt = null
  for (let i = 0; i < 66; i++) {
    const result = await register(mallory.sessionToken, apnsToken())
    if (result.status === 200) {
      tokens.push(result.json.registrationId)
    } else {
      refusedAt ??= i + 1 + 1 // +1 for brian's hijack registration above
    }
  }
  report('device registrations per host (cap 64)', refusedAt ? 'blocked' : 'VULNERABLE', {
    accepted: tokens.length + 1,
    firstRefusalAtRegistration: refusedAt
  })
  const counts = { queued: 0, rate_limited: 0, other: 0 }
  const batch = tokens.slice(0, 20)
  for (let i = 0; i < 17; i++) {
    const result = await send(mallory.sessionToken, batch, `spam ${i}`, 'x')
    for (const entry of result.json?.results ?? []) {
      counts[
        entry.status === 'queued'
          ? 'queued'
          : entry.status === 'rate_limited'
            ? 'rate_limited'
            : 'other'
      ]++
    }
  }
  report(
    'pushes per host per 15 min (quota 300)',
    counts.rate_limited > 0 ? 'blocked' : 'VULNERABLE',
    counts
  )
}

// ---- input handling: the token must never steer the provider request ----
{
  const cases = {
    'ios token with path traversal': { platform: 'ios', token: '../../v1/other' },
    'ios token with query': { platform: 'ios', token: 'abcd?x=1' },
    'apnsEnvironment as a host': {
      platform: 'ios',
      token: 'abcd',
      apnsEnvironment: 'attacker.example'
    },
    'android token as URL': {
      platform: 'android',
      token: 'http://169.254.169.254/latest/meta-data/aaaaaaaaaaaaaaaa'
    },
    'extra provider field': { platform: 'ios', token: 'abcd', host: 'attacker.example' }
  }
  for (const [label, extra] of Object.entries(cases)) {
    const result = await call('POST', '/v1/devices', mallory.sessionToken, {
      v: 1,
      deviceId: 'a',
      apnsEnvironment: 'production',
      ...extra
    })
    report(`register: ${label}`, result.status === 200 ? 'VULNERABLE' : 'blocked', {
      http: result.status
    })
  }
  // The test entry logs each provider request as `/<real hostname>/<path>`, so the hostname the
  // production code chose is the first path segment.
  const providerHosts = new Set(
    providerRequests(state.pushLog).map((entry) => entry.path.split('/')[1] ?? entry.path)
  )
  report(
    'provider hosts the Worker called (SSRF check)',
    [...providerHosts].every((host) =>
      [
        'api.push.apple.com',
        'api.sandbox.push.apple.com',
        'fcm.googleapis.com',
        'oauth2.googleapis.com'
      ].includes(host)
    )
      ? 'blocked'
      : 'VULNERABLE',
    { hosts: [...providerHosts] }
  )
}

// ---- the removed PUSH_PROVIDER_ORIGIN_OVERRIDE must be ignored ----
if (!state.providerOverrideDecoy) {
  report('provider override variable is ignored', 'skipped', {
    reason: 'the relay was started without the decoy; run lib/local-relay.mjs'
  })
} else {
  const before = deliveriesTo(brianPhoneToken).length
  await send(brian.sessionToken, [brianRegistration], 'override', 'probe')
  await sleep(300)
  const toOverride = providerRequests(state.pushLog).filter((entry) =>
    entry.path.startsWith(state.providerOverrideDecoy)
  )
  report(
    'PUSH_PROVIDER_ORIGIN_OVERRIDE is ignored by the production push path',
    toOverride.length === 0 && deliveriesTo(brianPhoneToken).length > before
      ? 'blocked'
      : 'VULNERABLE',
    {
      reason:
        'the override var points at a decoy path; the production push path must reach the real provider host, never the override',
      requestsToOverridePath: toOverride.length
    }
  )
}

// ---- what the relay sees of a notification ----
{
  const secret = `quarterly numbers ${randomUUID()}`
  await send(brian.sessionToken, [brianRegistration], 'Agent needs input', secret)
  await sleep(300)
  const seen = deliveriesTo(brianPhoneToken).some((entry) => entry.body.includes(secret))
  report(
    'notification title/body cross the relay (and APNs) in plaintext',
    seen ? 'info' : 'blocked',
    {
      reason:
        'by design the push alert is not end-to-end encrypted; keep secrets out of title/body',
      plaintextSeenAtProvider: seen
    }
  )
}

// ---- relay operator (Cloudflare account compromise) ----
const secrets = operatorSecrets()
if (!secrets) {
  report('operator scenario', 'skipped', {
    reason: 'start lib/local-relay.mjs with --expose-operator-secrets'
  })
} else {
  const expires = Date.now() + 3600_000
  const forged = signHostSession(secrets.HOST_SESSION_SECRET, brianKeys.hostId, expires)
  const devices = await call('GET', '/v1/devices', forged)
  const before = deliveriesTo(brianPhoneToken).length
  await send(
    forged,
    devices.json?.devices?.map((d) => d.registrationId) ?? [],
    'Seal security alert',
    'Approve the pending command on kessel-ml'
  )
  await sleep(300)
  report(
    "operator forges brian's host session from HOST_SESSION_SECRET and notifies his phone",
    deliveriesTo(brianPhoneToken).length > before ? 'info' : 'blocked',
    {
      reason:
        'by design the operator holds the signing secret and the APNs key, so push is trusted to the operator; it buys no plaintext and no command authority',
      devicesListed: devices.json?.devices?.length ?? 0
    }
  )
  // A forged session dated past the 24 h ceiling must be refused even with the real secret.
  const farFuture = signHostSession(
    secrets.HOST_SESSION_SECRET,
    brianKeys.hostId,
    Date.now() + 48 * 60 * 60 * 1000
  )
  const refused = await call('GET', '/v1/devices', farFuture)
  report(
    'forged session dated more than 24 h out',
    refused.status === 401 ? 'blocked' : 'VULNERABLE',
    { http: refused.status }
  )
}
finish()
