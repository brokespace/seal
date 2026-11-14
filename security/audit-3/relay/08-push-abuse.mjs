#!/usr/bin/env node
// Push endpoint abuse (/v1/devices, /v1/send), as: an external attacker with no key, a stranger
// who registers their own host key, another relay host, and the relay operator.
// Deliveries go to the fake APNs started by lib/local-relay.mjs, which logs each request, so
// "the phone was notified" is read from that log. Nothing reaches Apple.
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import {
  freshSourceIp,
  hostSession,
  newHostKeys,
  relayOrigin,
  relayState,
  report,
  setSourceIp,
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
function deliveriesTo(token) {
  return readFileSync(state.pushLog, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.path.endsWith(`/3/device/${token}`))
}

// ---- victim: brian's host with his phone registered ----
setSourceIp(freshSourceIp())
const brianKeys = newHostKeys()
const brian = await hostSession(origin, brianKeys)
const brianPhoneToken = apnsToken()
const brianRegistration = (await register(brian.sessionToken, brianPhoneToken)).json.registrationId

// ---- external attacker, no key ----
{
  const expires = Date.now() + 3600_000
  const guesses = {
    'no token': null,
    'random signature': `${brianKeys.hostId}.${expires}.${randomBytes(32).toString('base64url')}`,
    'empty-key HMAC': `${brianKeys.hostId}.${expires}.${createHmac('sha256', '').update(`seal-host-session/v1\0${brianKeys.hostId}\0${expires}`).digest('base64url')}`,
    'expired real token shape': `${brianKeys.hostId}.${Date.now() - 1000}.${brian.sessionToken.split('.')[2]}`,
    'real signature, later expiry': `${brianKeys.hostId}.${Number(brian.sessionToken.split('.')[1]) + 1}.${brian.sessionToken.split('.')[2]}`
  }
  for (const [label, token] of Object.entries(guesses)) {
    const list = await call('GET', '/v1/devices', token)
    const push = await send(token, [brianRegistration], 'x', 'y')
    report(
      `external: ${label}`,
      list.status === 200 || push.status === 200 ? 'VULNERABLE' : 'blocked',
      { devices: list.status, send: push.status }
    )
  }
}

// ---- a stranger with a self-generated key ----
setSourceIp(freshSourceIp())
const mallory = await hostSession(origin, newHostKeys())
{
  // Cross-host: brian's registration id through mallory's session.
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
    {
      send: crossSend.json?.results,
      deleteHttp: crossDelete.status,
      brianDevicesLeft: brianStill
    }
  )
  // The registration API takes any APNs token. If mallory learns brian's device token (it is not
  // an authenticator: the relay operator, Apple, and any earlier host the phone paired with hold
  // it), she registers it under her own host and pushes arbitrary text with the relay's APNs key.
  const before = deliveriesTo(brianPhoneToken).length
  const hijack = (await register(mallory.sessionToken, brianPhoneToken)).json.registrationId
  const pushed = await send(
    mallory.sessionToken,
    [hijack],
    'Seal: session expired',
    'Tap to sign in again at seal-login.example'
  )
  await sleep(300)
  const arrived = deliveriesTo(brianPhoneToken).slice(before)
  report(
    "mallory registers brian's APNs token under her own host and pushes attacker-chosen text",
    arrived.length > 0 ? 'VULNERABLE (needs the device token)' : 'blocked',
    {
      result: pushed.json?.results,
      deliveredAlert: arrived[0] ? JSON.parse(arrived[0].body).aps?.alert : null
    }
  )
}
{
  // Per-host caps: 64 devices and 300 pushes per 15 min. A new key is a new host.
  const tokens = []
  let refusedAt = null
  for (let i = 0; i < 66; i++) {
    const token = apnsToken()
    const result = await register(mallory.sessionToken, token)
    if (result.status === 200) {
      tokens.push({ token, id: result.json.registrationId })
    } else {
      refusedAt ??= i + 1 + 1
    }
  }
  report('device registrations per host', refusedAt ? 'blocked (cap enforced)' : 'VULNERABLE', {
    accepted: tokens.length + 1,
    firstRefusalAtRegistration: refusedAt
  })
  const counts = { queued: 0, rate_limited: 0, other: 0 }
  const batch = tokens.slice(0, 20).map((t) => t.id)
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
    'pushes per host per 15 min',
    counts.rate_limited > 0 ? 'blocked (quota enforced per host)' : 'VULNERABLE',
    counts
  )
  // Rotation: fresh keys each get a fresh quota (and a fresh device cap).
  let extra = 0
  for (let k = 0; k < 3; k++) {
    setSourceIp(freshSourceIp())
    const next = await hostSession(origin, newHostKeys())
    const ids = []
    for (const t of tokens.slice(0, 20)) {
      ids.push((await register(next.sessionToken, t.token)).json.registrationId)
    }
    for (let i = 0; i < 5; i++) {
      const result = await send(next.sessionToken, ids, `rotated ${k}/${i}`, 'x')
      extra += (result.json?.results ?? []).filter((entry) => entry.status === 'queued').length
    }
  }
  report(
    'quota after rotating to 3 fresh host keys',
    extra > 0 ? 'VULNERABLE (quota is per self-issued identity)' : 'blocked',
    {
      additionalPushesSameWindow: extra,
      totalThisWindow: counts.queued + extra,
      nominalCapPerHost: 300
    }
  )
}

// ---- input handling ----
{
  const cases = {
    'ios token with path traversal': {
      v: 1,
      deviceId: 'a',
      platform: 'ios',
      token: '../../v1/other',
      apnsEnvironment: 'production'
    },
    'ios token with query': {
      v: 1,
      deviceId: 'a',
      platform: 'ios',
      token: 'abcd?x=1',
      apnsEnvironment: 'production'
    },
    'apnsEnvironment as a host': {
      v: 1,
      deviceId: 'a',
      platform: 'ios',
      token: 'abcd',
      apnsEnvironment: 'attacker.example'
    },
    'android token as URL': {
      v: 1,
      deviceId: 'a',
      platform: 'android',
      token: 'http://169.254.169.254/latest/meta-data/aaaaaaaaaaaaaaaa'
    },
    'extra provider field': {
      v: 1,
      deviceId: 'a',
      platform: 'ios',
      token: 'abcd',
      apnsEnvironment: 'production',
      host: 'attacker.example'
    }
  }
  for (const [label, body] of Object.entries(cases)) {
    const result = await call('POST', '/v1/devices', mallory.sessionToken, body)
    report(`register: ${label}`, result.status === 200 ? 'VULNERABLE' : 'blocked', {
      http: result.status
    })
  }
  const providerHosts = new Set(
    readFileSync(state.pushLog, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line).path.split('/')[1])
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

// ---- what the relay sees of a notification ----
{
  const secret = `quarterly numbers ${randomUUID()}`
  await send(brian.sessionToken, [brianRegistration], 'Agent needs input', secret)
  await sleep(300)
  const seen = deliveriesTo(brianPhoneToken).some((entry) => entry.body.includes(secret))
  report(
    'notification title/body cross the relay (and APNs) in plaintext',
    seen ? 'info (not end-to-end encrypted)' : 'blocked',
    { plaintextSeenAtProvider: seen }
  )
}

// ---- relay operator (Cloudflare account compromise) ----
const operatorFile = '/tmp/seal-audit3/operator-secrets.json'
if (existsSync(operatorFile)) {
  const { HOST_SESSION_SECRET } = JSON.parse(readFileSync(operatorFile, 'utf8'))
  const expires = Date.now() + 3600_000
  const forged = `${brianKeys.hostId}.${expires}.${createHmac('sha256', HOST_SESSION_SECRET).update(`seal-host-session/v1\0${brianKeys.hostId}\0${expires}`).digest('base64url')}`
  const devices = await call('GET', '/v1/devices', forged)
  const before = deliveriesTo(brianPhoneToken).length
  const pushed = await send(
    forged,
    devices.json?.devices?.map((d) => d.registrationId) ?? [],
    'Seal security alert',
    'Approve the pending command on kessel-ml'
  )
  await sleep(300)
  report(
    "operator forges brian's host session from HOST_SESSION_SECRET and notifies his phone",
    deliveriesTo(brianPhoneToken).length > before
      ? 'VULNERABLE (by design: operator is trusted for push)'
      : 'blocked',
    {
      devicesListed: devices.json?.devices?.length ?? 0,
      result: pushed.json?.results
    }
  )
} else {
  report('operator scenario', 'skipped', {
    reason: 'start lib/local-relay.mjs with --expose-operator-secrets'
  })
}
process.exit(0)
