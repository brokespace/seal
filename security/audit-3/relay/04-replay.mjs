#!/usr/bin/env node
// Attacker: someone who recorded traffic or stole a single credential (a network observer that
// broke TLS, a stolen phone, a leaked log). Replays each credential the relay protocol uses.
import { randomUUID } from 'node:crypto'
import {
  controlConnect,
  controlRequest,
  createInvite,
  dataAttach,
  freshSourceIp,
  hostOnline,
  installResumeCredential,
  openSocket,
  phoneOpen,
  postJson,
  relayAuthFrame,
  relayOrigin,
  report,
  revokeDevice,
  setSourceIp,
  sha256B64url,
  sleep,
  splice,
  wsOrigin,
  randomToken
} from '../lib/relay-protocol.mjs'

const origin = relayOrigin()
setSourceIp(freshSourceIp())
const host = await hostOnline(origin)

// ---- host session proof ----
{
  const again = await postJson(origin, '/v1/host/session', {
    v: 1,
    challengeId: host.session.challenge.challengeId,
    proofB64: host.session.proofB64
  })
  report('replay of a used host-session proof', again.status === 200 ? 'VULNERABLE' : 'blocked', {
    http: again.status
  })
}

// ---- control handshake ----
{
  // A recorded hello/ack pair replayed on a fresh control socket (the attacker holds the relay
  // JWT but not the host's X25519 secret key).
  const recorded = await controlConnect(
    origin,
    host.relayToken,
    host.keys,
    host.assignment.assignmentEpoch
  )
  const socket = openSocket(`${wsOrigin(origin)}/v1/host/control`, {
    headers: { authorization: `Bearer ${host.relayToken}` }
  })
  await socket.open()
  socket.sendJson({
    type: 'host-hello',
    v: 1,
    relayHostId: host.keys.hostId,
    assignmentEpoch: host.assignment.assignmentEpoch,
    hostPublicKeyB64: host.keys.publicKeyB64,
    appVersion: 'replay'
  })
  const challenge = await socket.nextJson()
  socket.sendJson({
    type: 'host-challenge-ack',
    challengeId: recorded.challenge.challengeId,
    proofB64: recorded.proofB64
  })
  const first = await socket.nextJson(1500)
  const second = openSocket(`${wsOrigin(origin)}/v1/host/control`, {
    headers: { authorization: `Bearer ${host.relayToken}` }
  })
  await second.open()
  second.sendJson({
    type: 'host-hello',
    v: 1,
    relayHostId: host.keys.hostId,
    assignmentEpoch: host.assignment.assignmentEpoch,
    hostPublicKeyB64: host.keys.publicKeyB64,
    appVersion: 'replay'
  })
  const challenge2 = await second.nextJson()
  second.sendJson({
    type: 'host-challenge-ack',
    challengeId: challenge2.challengeId,
    proofB64: recorded.proofB64
  })
  const reply = await second.nextJson(1500)
  report(
    'stolen relay JWT + replayed host proof (no host secret key)',
    first?.type === 'host-hello-ack' || reply?.type === 'host-hello-ack' ? 'VULNERABLE' : 'blocked',
    {
      gotChallenge: challenge?.type === 'host-challenge',
      close: [await socket.waitClosed(1500), await second.waitClosed(1500)]
    }
  )
  // The replacement control above took over the seat; continue with it.
  host.control.ws.terminate()
  host.control = recorded.socket
  host.ack = recorded.ack
}

// ---- data ticket ----
{
  const invite = await createInvite(host.control)
  const live = await splice(origin, host, invite.inviteToken)
  const second = await dataAttach(origin, live.open, host.ack.generation)
  // The refusal's close frame arrives late (about 10 s locally); frames on the refused socket are ignored meanwhile.
  second.ws.send(Buffer.from('injected-by-replayed-ticket'))
  const secondClose = await second.waitClosed(15000)
  // The first splice must be unaffected by the replay attempt.
  const leaked = await live.phone.next(500)
  live.phone.ws.send(Buffer.from('still-alive'))
  const forwarded = await live.data.next(2000)
  report(
    'replay of a used connTicket on a second data socket',
    secondClose?.code === 4401 && leaked === null && forwarded?.toString() === 'still-alive'
      ? 'blocked'
      : 'VULNERABLE',
    {
      secondClose,
      injectedFrameReachedPhone: leaked !== null,
      firstSpliceIntact: forwarded?.toString() === 'still-alive'
    }
  )
  live.phone.ws.terminate()
  await sleep(300)
  const afterClose = await dataAttach(origin, live.open, host.ack.generation)
  report(
    'replay of a connTicket after its splice closed',
    (await afterClose.waitClosed(15000))?.code === 4401 ? 'blocked' : 'VULNERABLE',
    { close: afterClose.closed }
  )
}

// ---- invite (the pairing credential in the QR code) ----
{
  const invite = await createInvite(host.control)
  const first = await splice(origin, host, invite.inviteToken)
  // While the first redemption is live, a second party presents the same invite.
  const thief = await phoneOpen(origin, host.keys.hostId)
  thief.ws.send(relayAuthFrame(invite.inviteToken))
  const thiefHello = await thief.nextJson(2000)
  report(
    'invite replayed while the first redemption is connected',
    thiefHello?.ok === true ? 'VULNERABLE' : 'blocked',
    { hello: thiefHello }
  )
  // The phone drops before the host installs its resume credential (pairing interrupted).
  first.phone.ws.terminate()
  await sleep(2300) // inviteAttemptCooldownMs
  let reused = 0
  for (let i = 0; i < 6; i++) {
    const again = await splice(origin, host, invite.inviteToken)
    if (again.hello?.ok === true) {
      reused++
    }
    again.phone?.ws.terminate()
    again.data?.ws.terminate()
    await sleep(2300)
  }
  report(
    'invite replayed after an interrupted pairing (within its 10 min TTL)',
    reused > 0 ? 'info (reusable until installed; capped by maxAttempts)' : 'blocked',
    {
      acceptedReplays: reused,
      maxAttempts: 5
    }
  )
  // Completed pairing: the host installs a resume credential on the invite's connection basis.
  const invite2 = await createInvite(host.control)
  const paired = await splice(origin, host, invite2.inviteToken)
  const resumeToken = randomToken()
  const installed = await controlRequest(
    host.control,
    'device-credential-install',
    {
      v: 1,
      relayDeviceId: invite2.relayDeviceId,
      newResumeTokenHash: sha256B64url(resumeToken),
      authorization: { mode: 'relay-basis', basisConnId: paired.open.connId }
    },
    'device-credential-installed'
  )
  paired.phone.ws.terminate()
  await sleep(2300)
  const afterInstall = await splice(origin, host, invite2.inviteToken)
  report(
    'invite replayed after pairing completed',
    afterInstall.hello?.ok === true ? 'VULNERABLE' : 'blocked',
    { installed: installed?.type, hello: afterInstall.hello }
  )

  // ---- resume token ----
  const one = await splice(origin, host, resumeToken)
  const two = await splice(origin, host, resumeToken)
  report(
    'one resume token on two simultaneous connections (stolen-credential reuse)',
    one.hello?.ok && two.hello?.ok
      ? 'info (accepted; the relay does not detect concurrent use)'
      : 'blocked',
    {
      first: one.hello?.ok,
      second: two.hello?.ok
    }
  )
  await revokeDevice(host.control, invite2.relayDeviceId)
  const afterRevoke = await splice(origin, host, resumeToken)
  report(
    'resume token after device-revoke',
    afterRevoke.hello?.ok === true ? 'VULNERABLE' : 'blocked',
    { hello: afterRevoke.hello }
  )
  // Do the connections that were already open survive the revoke at the relay?
  one.phone.ws.send(Buffer.from('after-revoke'))
  const stillForwarded = await one.data.next(2000)
  report(
    'splice opened before device-revoke keeps forwarding after it',
    stillForwarded?.toString() === 'after-revoke'
      ? 'VULNERABLE (relay leaves live splices of a revoked device open)'
      : 'blocked',
    {
      forwarded: stillForwarded?.toString() ?? null,
      phoneClose: one.phone.closed
    }
  )
}

// ---- rotated resume token ----
{
  const device = await installResumeCredential(host.control)
  const rotated = randomToken()
  const rotation = await controlRequest(
    host.control,
    'device-credential-install',
    {
      v: 1,
      relayDeviceId: device.relayDeviceId,
      newResumeTokenHash: sha256B64url(rotated),
      expectedCurrentHash: sha256B64url(device.resumeToken),
      authorization: { mode: 'authenticated-direct', directAuthId: randomUUID() }
    },
    'device-credential-installed'
  )
  const old = await splice(origin, host, device.resumeToken)
  report(
    'previous resume token after rotation',
    old.hello?.ok === true ? 'info (accepted for the 24 h grace window)' : 'blocked',
    { rotation: rotation?.type, hello: old.hello }
  )
}
host.control.ws.terminate()
process.exit(0)
