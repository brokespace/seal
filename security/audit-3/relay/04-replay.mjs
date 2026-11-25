#!/usr/bin/env node
// Attacker: someone who recorded traffic or stole a single credential (a network observer that
// broke TLS, a stolen phone, a leaked log). Replays each credential the relay protocol uses; a
// used or revoked one must be refused, and a revoke must end what the credential already opened.
import { randomUUID } from 'node:crypto'
import {
  controlConnect,
  controlRequest,
  createInvite,
  dataAttach,
  finish,
  freshSourceIp,
  hostOnline,
  installResumeCredential,
  nextConnOpen,
  openSocket,
  phoneAttempt,
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

// RELAY_PROTOCOL_LIMITS: cooldown between attempts on one invite, and attempts per invite.
const INVITE_COOLDOWN_MS = 2000
const INVITE_MAX_ATTEMPTS = 5
const origin = relayOrigin()
setSourceIp(freshSourceIp())
const host = await hostOnline(origin)

// ---- how long a stolen host token stays useful ----
{
  const sessionMs = Number(host.session.sessionToken.split('.')[1]) - Date.now()
  const jwtClaims = JSON.parse(Buffer.from(host.relayToken.split('.')[1], 'base64url').toString())
  const relayJwtMs = jwtClaims.exp * 1000 - Date.now()
  report(
    'lifetime of a stolen host session token and relay JWT',
    sessionMs <= 60 * 60 * 1000 && relayJwtMs <= 5 * 60 * 1000 ? 'blocked' : 'VULNERABLE',
    {
      sessionMinutes: Math.round(sessionMs / 60000),
      relayJwtMinutes: Math.round(relayJwtMs / 60000)
    }
  )
}

// ---- host session proof ----
{
  const again = await postJson(origin, '/v1/host/session', {
    v: 1,
    challengeId: host.session.challenge.challengeId,
    proofB64: host.session.proofB64
  })
  report('replay of a used host-session proof', again.status === 401 ? 'blocked' : 'VULNERABLE', {
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
  const hello = {
    type: 'host-hello',
    v: 1,
    relayHostId: host.keys.hostId,
    assignmentEpoch: host.assignment.assignmentEpoch,
    hostPublicKeyB64: host.keys.publicKeyB64,
    appVersion: 'replay'
  }
  const replies = []
  // The recorded proof against the recorded challenge id, then against the fresh one.
  for (const useRecordedChallengeId of [true, false]) {
    const socket = openSocket(`${wsOrigin(origin)}/v1/host/control`, {
      headers: { authorization: `Bearer ${host.relayToken}` }
    })
    await socket.open()
    socket.sendJson(hello)
    const challenge = await socket.nextJson()
    socket.sendJson({
      type: 'host-challenge-ack',
      challengeId: useRecordedChallengeId ? recorded.challenge.challengeId : challenge?.challengeId,
      proofB64: recorded.proofB64
    })
    const reply = await socket.nextJson(1500)
    replies.push({
      gotChallenge: challenge?.type === 'host-challenge',
      reply: reply?.type ?? null,
      close: await socket.waitClosed(1500)
    })
  }
  report(
    'stolen relay JWT + replayed host proof (no host secret key)',
    replies.every((r) => r.gotChallenge && r.reply === null && r.close?.code === 4401) &&
      recorded.socket.closed === null
      ? 'blocked'
      : 'VULNERABLE',
    { attempts: replies, realControlOpen: recorded.socket.closed === null }
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
  second.ws.send(Buffer.from('injected-by-replayed-ticket'))
  // The first splice must be unaffected by the replay attempt.
  const leaked = await live.phone.next(500)
  live.phone.ws.send(Buffer.from('still-alive'))
  const forwarded = await live.data.next(2000)
  const secondClose = await second.waitClosed(3000)
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
  const close = await afterClose.waitClosed(3000)
  report(
    'replay of a connTicket after its splice closed',
    close?.code === 4401 ? 'blocked' : 'VULNERABLE',
    { close }
  )
}

// ---- invite (the pairing credential in the QR code) ----
{
  const invite = await createInvite(host.control)
  const first = await splice(origin, host, invite.inviteToken)
  // While the first redemption is live, a second party presents the same invite.
  const thief = await phoneAttempt(origin, host.keys.hostId, invite.inviteToken, 2000)
  report(
    'invite replayed while the first redemption is connected',
    thief.hello?.ok === false ? 'blocked' : 'VULNERABLE',
    { hello: thief.hello }
  )
  first.phone.ws.terminate()
  // The phone drops before the host attaches (pairing interrupted): the invite stays usable so
  // the phone can retry, but only for its capped number of attempts.
  const interrupted = await createInvite(host.control)
  let accepted = 0
  let refused = null
  for (let i = 0; i <= INVITE_MAX_ATTEMPTS && !refused; i++) {
    const phone = await phoneOpen(origin, host.keys.hostId)
    phone.ws.send(relayAuthFrame(interrupted.inviteToken))
    if (await nextConnOpen(host.control, 1500)) {
      accepted++
    } else {
      refused = await phone.nextJson(1000)
    }
    phone.ws.terminate()
    await sleep(INVITE_COOLDOWN_MS + 300)
  }
  report(
    'invite replayed after an interrupted pairing (within its 10 min TTL)',
    refused?.code === 4401 && accepted <= INVITE_MAX_ATTEMPTS ? 'info' : 'VULNERABLE',
    {
      reason: `by design an invite is reusable until its credential is installed, for at most ${INVITE_MAX_ATTEMPTS} attempts`,
      acceptedAttempts: accepted,
      thenRefused: refused
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
  await sleep(INVITE_COOLDOWN_MS + 300)
  const afterInstall = await splice(origin, host, invite2.inviteToken)
  report(
    'invite replayed after pairing completed',
    installed?.type === 'device-credential-installed' && afterInstall.hello?.ok === false
      ? 'blocked'
      : 'VULNERABLE',
    { installed: installed?.type, hello: afterInstall.hello }
  )

  // ---- resume token ----
  const one = await splice(origin, host, resumeToken)
  const two = await splice(origin, host, resumeToken)
  report(
    'one resume token on two simultaneous connections (stolen-credential reuse)',
    one.hello?.ok && two.hello?.ok ? 'info' : 'blocked',
    {
      reason:
        'by design the relay cannot tell a copied token from the phone; a device is capped at 4 connections and device-revoke ends them (below)',
      first: one.hello?.ok,
      second: two.hello?.ok
    }
  )
  const revoked = await revokeDevice(host.control, invite2.relayDeviceId)
  // The connections that were already open must not survive the revoke at the relay.
  const closes = [await one.phone.waitClosed(3000), await two.phone.waitClosed(3000)]
  one.phone.ws.send(Buffer.from('after-revoke'), () => {})
  const stillForwarded = await one.data.next(1000)
  report(
    'splice opened before device-revoke keeps forwarding after it',
    revoked?.type === 'device-revoked' &&
      closes.every((close) => close?.code === 4401 && close.reason === 'device revoked') &&
      stillForwarded === null
      ? 'blocked'
      : 'VULNERABLE',
    { revoke: revoked?.type, phoneCloses: closes, forwarded: stillForwarded?.toString() ?? null }
  )
  const afterRevoke = await splice(origin, host, resumeToken)
  report(
    'resume token after device-revoke',
    afterRevoke.hello?.ok === false && afterRevoke.hello.code === 4401 ? 'blocked' : 'VULNERABLE',
    { hello: afterRevoke.hello }
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
  report('previous resume token after rotation', old.hello?.ok === true ? 'info' : 'blocked', {
    reason:
      'by design the previous token is accepted for a 24 h grace window, so a phone that missed the rotation is not locked out',
    rotation: rotation?.type,
    acceptedAs: old.hello?.acceptedAs ?? null
  })
}
host.control.ws.terminate()
finish()
