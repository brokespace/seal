#!/usr/bin/env node
// Attacker 1: a stranger with a self-generated X25519 key. The relay serves only the host keys on
// its allowlist, so the stranger must be refused on every path, even holding validly signed tokens
// (a host that was taken off the allowlist).
// Attacker 2: another enrolled host on the same relay ("mallory"), holding a fully valid host
// session, relay JWT and control socket for her own key, and turning them on a victim host
// ("brian") that shares the Worker.
import { randomUUID } from 'node:crypto'
import {
  controlRequest,
  createInvite,
  dataAttach,
  finish,
  freshSourceIp,
  hostChallenge,
  hostOnline,
  installResumeCredential,
  newHostKeys,
  nextConnOpen,
  openSocket,
  operatorSecrets,
  phoneAttempt,
  phoneOpen,
  postJson,
  relayAuthFrame,
  relayOrigin,
  report,
  revokeDevice,
  setSourceIp,
  sha256B64url,
  signHostSession,
  signRelayJwt,
  sourceHeaders,
  splice,
  wsOrigin,
  randomToken
} from '../lib/relay-protocol.mjs'

const origin = relayOrigin()
setSourceIp(freshSourceIp())
const brian = await hostOnline(origin)
const brianDevice = await installResumeCredential(brian.control)

// ---- a stranger's key ----
setSourceIp(freshSourceIp())
const stranger = newHostKeys()
{
  const challenge = await hostChallenge(origin, stranger)
  // A proof for a challenge the relay never issued: only the enrolment refusal may answer it.
  const session = await postJson(origin, '/v1/host/session', {
    v: 1,
    challengeId: `${stranger.hostId}.${randomUUID()}`,
    proofB64: Buffer.alloc(32, 1).toString('base64')
  })
  report(
    '1. a stranger with a self-generated key becomes a relay host (no allowlist, no enrollment secret)',
    challenge.status === 403 && session.status === 403 ? 'blocked' : 'VULNERABLE',
    { strangerHostId: stranger.hostId, challenge: challenge.status, session: session.status }
  )
}
{
  // What a host taken off the allowlist still holds: tokens the relay itself signed.
  const secrets = operatorSecrets()
  if (!secrets) {
    report('a host off the allowlist presenting validly signed tokens', 'skipped', {
      reason: 'start lib/local-relay.mjs with --expose-operator-secrets'
    })
  } else {
    const sessionFor = (hostId) =>
      signHostSession(secrets.HOST_SESSION_SECRET, hostId, Date.now() + 30 * 60 * 1000)
    const withSession = async (keys) => {
      const call = (method, path, body) =>
        fetch(`${origin}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${sessionFor(keys.hostId)}`,
            'content-type': 'application/json',
            ...sourceHeaders()
          },
          ...(body ? { body: JSON.stringify(body) } : {})
        }).then((response) => response.status)
      return {
        relayToken: await call('POST', '/v1/host/relay-token', {
          relayHostId: keys.hostId,
          hostPublicKeyB64: keys.publicKeyB64
        }),
        listDevices: await call('GET', '/v1/devices'),
        send: await call('POST', '/v1/send', {}),
        removeDevice: await call('DELETE', `/v1/devices/${randomUUID()}`),
        mcpTunnel: await call('GET', '/v1/host/mcp')
      }
    }
    const withRelayJwt = async (keys) => {
      const jwt = await signRelayJwt(secrets.RELAY_JWT_PRIVATE_JWK, keys.hostId)
      const assign = await postJson(
        origin,
        '/v1/assign',
        { v: 1, relayHostId: keys.hostId },
        { authorization: `Bearer ${jwt}` }
      )
      const control = openSocket(`${wsOrigin(origin)}/v1/host/control`, {
        headers: { authorization: `Bearer ${jwt}` }
      })
      await control.open()
      control.ws.terminate()
      return { assign: assign.status, controlUpgrade: control.upgradeStatus ?? 101 }
    }
    const delisted = { ...(await withSession(stranger)), ...(await withRelayJwt(stranger)) }
    // The same forged tokens for an enrolled host are honoured: the refusals above are enrolment.
    const enrolled = await withRelayJwt(brian.keys)
    const enrolledDevices = (await withSession(brian.keys)).listDevices
    report(
      'a host off the allowlist presenting validly signed tokens',
      Object.values(delisted).every((status) => status === 403) &&
        enrolled.assign === 200 &&
        enrolledDevices === 200
        ? 'blocked'
        : 'VULNERABLE',
      {
        offAllowlist: delisted,
        sameTokensForEnrolledHost: { ...enrolled, listDevices: enrolledDevices }
      }
    )
  }
}

// ---- another enrolled host ----
setSourceIp(freshSourceIp())
const mallory = await hostOnline(origin)

// ---- HTTP: mallory's credentials naming brian ----
{
  const token = await postJson(
    origin,
    '/v1/host/relay-token',
    { relayHostId: brian.keys.hostId, hostPublicKeyB64: brian.keys.publicKeyB64 },
    { authorization: `Bearer ${mallory.session.sessionToken}` }
  )
  report(
    "relay token for brian's host id with mallory's session",
    token.status === 403 ? 'blocked' : 'VULNERABLE',
    { http: token.status }
  )
  const assignment = await postJson(
    origin,
    '/v1/assign',
    { v: 1, relayHostId: brian.keys.hostId },
    { authorization: `Bearer ${mallory.relayToken}` }
  )
  report(
    "/v1/assign for brian's host id with mallory's relay JWT",
    assignment.status === 403 ? 'blocked' : 'VULNERABLE',
    { http: assignment.status }
  )
  // Session token with brian's fingerprint spliced onto mallory's expiry and signature.
  const [, expires, signature] = mallory.session.sessionToken.split('.')
  const forged = await fetch(`${origin}/v1/devices`, {
    headers: { authorization: `Bearer ${brian.keys.hostId}.${expires}.${signature}` }
  })
  report(
    "session token re-labelled with brian's fingerprint",
    forged.status === 401 ? 'blocked' : 'VULNERABLE',
    { http: forged.status }
  )
}

// ---- control commands aimed at brian's device ----
{
  const revoke = await revokeDevice(mallory.control, brianDevice.relayDeviceId)
  const stillWorks = await splice(origin, brian, brianDevice.resumeToken)
  report(
    "mallory sends device-revoke for brian's relayDeviceId",
    stillWorks.hello?.ok === true ? 'blocked' : 'VULNERABLE',
    { reply: revoke?.type, brianPhoneStillConnects: stillWorks.hello?.ok }
  )
  stillWorks.phone.ws.terminate()
  // Mallory installs her own token for brian's device id, then presents it on brian's host.
  const planted = randomToken()
  await controlRequest(
    mallory.control,
    'device-credential-install',
    {
      v: 1,
      relayDeviceId: brianDevice.relayDeviceId,
      newResumeTokenHash: sha256B64url(planted),
      authorization: { mode: 'authenticated-direct', directAuthId: randomUUID() }
    },
    'device-credential-installed'
  )
  const plantedAttempt = await phoneAttempt(origin, brian.keys.hostId, planted, 2500)
  report(
    "credential installed through mallory's control presented at brian's host",
    plantedAttempt.hello?.code === 4401 ? 'blocked' : 'VULNERABLE',
    { hello: plantedAttempt.hello }
  )
  // And mallory's own invite at brian's host.
  const invite = await createInvite(mallory.control)
  const inviteAttempt = await phoneAttempt(origin, brian.keys.hostId, invite.inviteToken, 2500)
  report(
    "mallory's invite presented at brian's host",
    inviteAttempt.hello?.code === 4401 ? 'blocked' : 'VULNERABLE',
    { hello: inviteAttempt.hello }
  )
}

// ---- brian's data path ----
{
  // Mallory's data socket presenting her own valid ticket on a connId under brian's host id.
  const invite = await createInvite(mallory.control)
  const own = await phoneOpen(origin, mallory.keys.hostId)
  own.ws.send(relayAuthFrame(invite.inviteToken))
  const open = await nextConnOpen(mallory.control)
  const data = await dataAttach(
    origin,
    {
      connId: open.connId.replace(mallory.keys.hostId, brian.keys.hostId),
      connTicket: open.connTicket
    },
    mallory.ack.generation
  )
  const close = await data.waitClosed(3000)
  report(
    "mallory's ticket on a connId rewritten to brian's host id",
    close?.code === 4401 ? 'blocked' : 'VULNERABLE',
    { close }
  )
  own.ws.terminate()
}
{
  // If a connId leaks, the first data socket to arrive occupies the splice before proving the
  // ticket; the real host's socket is then refused until the attach deadline.
  const phone = await phoneOpen(origin, brian.keys.hostId)
  phone.ws.send(relayAuthFrame(brianDevice.resumeToken))
  const open = await nextConnOpen(brian.control)
  const squatter = openSocket(`${wsOrigin(origin)}/v1/host/data/${encodeURIComponent(open.connId)}`)
  await squatter.open()
  const real = await dataAttach(origin, open, brian.ack.generation)
  const realClose = await real.waitClosed(1500)
  const hello = realClose ? null : await phone.nextJson(3000)
  // The next connection gets a fresh connId, so the squatter denied exactly one attempt.
  const next = await splice(origin, brian, brianDevice.resumeToken)
  report(
    'data socket squatting with a leaked connId (ticket unknown)',
    hello?.ok === true ? 'blocked' : next.hello?.ok === true ? 'info' : 'VULNERABLE',
    {
      reason:
        'needs the 122-bit connId the relay sends only to the host; denies that one connection until the 10 s attach deadline, and the phone reconnects',
      realHostDataClose: realClose,
      nextConnectionHello: next.hello?.ok ?? null
    }
  )
  squatter.ws.terminate()
}

// ---- same-key takeover needs the key ----
report('host id is 96 bits of SHA-256 over the public key', 'info', {
  reason: 'arithmetic, not an attack',
  secondPreimageWork: '2^96 key generations to collide with a chosen host id'
})
brian.control.ws.terminate()
mallory.control.ws.terminate()
finish()
