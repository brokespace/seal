#!/usr/bin/env node
// Attacker: external, no credential; knows the victim's relay host id (it is in every pairing QR).
// Unauthenticated sockets must be closed at the first-frame deadline however they stall, an idle
// authenticated splice must time out, a flood from several addresses must not keep a real phone
// out, one stolen credential must not take every connection seat, and the limiter must answer the
// excess from one address.
import { randomBytes } from 'node:crypto'
import {
  finish,
  freshSourceIp,
  hostOnline,
  installResumeCredential,
  openSocket,
  phoneAttempt,
  phoneOpen,
  relayOrigin,
  relayState,
  report,
  setSourceIp,
  sleep,
  splice,
  wsOrigin
} from '../lib/relay-protocol.mjs'

// RELAY_PROTOCOL_LIMITS.firstFrameDeadlineMs, plus slack for the local runtime.
const FIRST_FRAME_DEADLINE_MS = 2000
const SLACK_MS = 1500
const origin = relayOrigin()
const state = relayState()
setSourceIp(freshSourceIp())
const victim = await hostOnline(origin)
const hostId = victim.keys.hostId
const device = await installResumeCredential(victim.control)

async function lifetime(open, act) {
  const started = Date.now()
  const socket = await open()
  act?.(socket)
  const close = await socket.waitClosed(30000)
  return { heldMs: close ? Date.now() - started : null, close }
}
const firstFrameTimeout = ({ heldMs, close }) =>
  heldMs !== null &&
  heldMs <= FIRST_FRAME_DEADLINE_MS + SLACK_MS &&
  close.code === 4408 &&
  close.reason === 'first frame timeout'

// ---- slowloris: how long is one silent / stalled socket held? ----
setSourceIp(freshSourceIp())
const stalls = {
  'idle unauthenticated phone socket on a live host': () =>
    lifetime(() => phoneOpen(origin, hostId)),
  'idle unauthenticated phone socket on an unknown host': () =>
    lifetime(() => phoneOpen(origin, randomBytes(12).toString('base64url'))),
  'phone socket that starts a frame and never finishes it': () =>
    lifetime(
      () => phoneOpen(origin, hostId),
      // Text frame header announcing 100 bytes, then 10 bytes of payload and nothing more.
      (socket) =>
        socket.ws._socket.write(
          Buffer.concat([Buffer.from([0x81, 0x80 | 100, 0, 0, 0, 0]), Buffer.alloc(10, 0x7b)])
        )
    ),
  'phone socket dripping one byte per 500 ms': () =>
    lifetime(
      () => phoneOpen(origin, hostId),
      (socket) => {
        const frame = Buffer.concat([
          Buffer.from([0x81, 0x80 | 100, 0, 0, 0, 0]),
          Buffer.alloc(100, 0x20)
        ])
        let index = 0
        const timer = setInterval(() => {
          if (index >= frame.length - 1 || socket.closed) {
            return clearInterval(timer)
          }
          try {
            socket.ws._socket.write(frame.subarray(index, ++index))
          } catch {
            clearInterval(timer)
          }
        }, 500)
      }
    )
}
const stalled = await Promise.all(Object.values(stalls).map((run) => run()))
for (const [index, name] of Object.keys(stalls).entries()) {
  report(name, firstFrameTimeout(stalled[index]) ? 'blocked' : 'VULNERABLE', stalled[index])
}
{
  const refused = await lifetime(() => {
    const socket = openSocket(
      `${wsOrigin(origin)}/v1/host/data/${hostId}.0.${randomBytes(8).toString('hex')}`
    )
    return socket.open().then(() => socket)
  })
  report(
    'unauthenticated host-data socket on an unknown connId',
    refused.heldMs !== null && refused.heldMs <= SLACK_MS && refused.close.code === 4401
      ? 'blocked'
      : 'VULNERABLE',
    refused
  )
}

// ---- an authenticated splice that goes silent ----
if (!state.spliceIdleTimeoutMs) {
  report('authenticated splice left silent', 'skipped', {
    reason:
      'the Worker closes it after 10 min; start lib/local-relay.mjs with --splice-idle-timeout-ms 3000 to watch it'
  })
} else {
  const idleMs = state.spliceIdleTimeoutMs
  const silent = await splice(origin, victim, device.resumeToken)
  const busy = await splice(origin, victim, device.resumeToken)
  // A splice that keeps talking must outlive the silent one: the timeout is on idleness.
  const chatter = setInterval(() => busy.phone.ws.send(Buffer.from('tick'), () => {}), idleMs / 3)
  const started = Date.now()
  const closes = [await silent.phone.waitClosed(idleMs * 3), await silent.data.waitClosed(1000)]
  report(
    `authenticated splice left silent (idle timeout ${idleMs} ms)`,
    closes.every((close) => close?.code === 4408 && close.reason === 'idle timeout') &&
      busy.phone.closed === null
      ? 'blocked'
      : 'VULNERABLE',
    { closedAfterMs: Date.now() - started, closes, busySpliceStillOpen: busy.phone.closed === null }
  )
  clearInterval(chatter)
  busy.phone.ws.terminate()
}

// ---- flood: park sockets on the victim from many addresses ----
{
  const SOURCES = Number(process.env.SOURCES ?? 20)
  const PER_SOURCE = 120 // the per-source pre-auth budget per minute
  const parked = []
  let refused = 0
  const started = Date.now()
  for (let s = 0; s < SOURCES; s++) {
    setSourceIp(freshSourceIp())
    const batch = await Promise.all(
      Array.from({ length: PER_SOURCE }, () => phoneOpen(origin, hostId))
    )
    for (const socket of batch) {
      if (socket.upgradeStatus) {
        refused++
      } else {
        parked.push(socket)
      }
    }
  }
  // A real phone, retried for a few seconds: the flood holds the 16-per-slot seats, but each
  // unauthenticated socket is dropped at the 2 s first-frame deadline, so seats free up.
  setSourceIp(freshSourceIp())
  const t = Date.now()
  let legit = null
  let legitAttempts = 0
  while (Date.now() - t < 8000) {
    legitAttempts++
    const attempt = await splice(origin, victim, device.resumeToken)
    if (attempt.hello?.ok === true) {
      legit = attempt
      break
    }
    attempt.phone?.ws.terminate()
    await sleep(250)
  }
  report(
    `flood: ${SOURCES} addresses x ${PER_SOURCE} unauthenticated phone upgrades`,
    legit?.hello?.ok === true && victim.control.closed === null ? 'blocked' : 'VULNERABLE',
    {
      upgradesAccepted: parked.length,
      refused429: refused,
      floodSeconds: Number(((Date.now() - started) / 1000).toFixed(1)),
      legitPhoneConnected: legit?.hello?.ok === true,
      legitAttempts,
      legitConnectMs: Date.now() - t,
      victimControlOpen: victim.control.closed === null
    }
  )
  report('a saturating flood briefly refuses new phone connections', 'info', {
    reason:
      'the 16-per-slot cap (128 unauthenticated sockets per host) bounds memory but lets a flood refuse new phones with 429 until the 2 s first-frame deadline frees seats; a sustained flood must keep beating the per-source pre-auth limiter from many prefixes',
    newPhoneRefusedWhileFull: refused > 0
  })
  for (const socket of parked) {
    socket.ws.terminate()
  }
  legit?.phone?.ws.terminate()
  await sleep(FIRST_FRAME_DEADLINE_MS + 500)
}
{
  // A stolen (not yet revoked) credential may fill its device's share of the host's 8 seats, but
  // the owner's other devices must still get in.
  setSourceIp(freshSourceIp())
  const held = []
  for (let i = 0; i < 4; i++) {
    held.push(await splice(origin, victim, device.resumeToken))
  }
  const fifth = await phoneAttempt(origin, hostId, device.resumeToken)
  const otherDevice = await installResumeCredential(victim.control)
  const owner = await splice(origin, victim, otherDevice.resumeToken)
  report(
    'one stolen credential holding all 8 connection slots',
    held.every((h) => h.hello?.ok === true) &&
      fifth.hello?.code === 4429 &&
      owner.hello?.ok === true
      ? 'blocked'
      : 'VULNERABLE',
    {
      heldByStolenCredential: held.filter((h) => h.hello?.ok === true).length,
      fifthHello: fifth.hello,
      ownersOtherDeviceHello: owner.hello?.ok ?? null
    }
  )
  for (const h of [...held, owner]) {
    h.phone.ws.terminate()
  }
}

// ---- cost: billable requests one address can cause ----
{
  const address = freshSourceIp()
  const started = Date.now()
  let sent = 0
  let limited = 0
  const DURATION_MS = Number(process.env.COST_PROBE_MS ?? 3000)
  while (Date.now() - started < DURATION_MS) {
    const batch = await Promise.all(
      Array.from({ length: 50 }, () =>
        fetch(`${origin}/v1/connect/${hostId}`, {
          headers: { 'cf-connecting-ip': address }
        }).then((r) => r.status)
      )
    )
    sent += batch.length
    limited += batch.filter((status) => status === 429).length
  }
  const perSecond = sent / ((Date.now() - started) / 1000)
  // The local limiter counts per wall-clock minute, so up to two budgets can pass before the 429s.
  report(
    'Worker invocations from one address (the limiter runs inside the Worker)',
    sent - limited <= 2 * 120 ? 'info' : 'VULNERABLE',
    {
      reason:
        'the Worker refuses the excess (429) but a refused request is still a billed invocation; only a zone-level WAF rate rule stops it before the Worker',
      requestsSent: sent,
      answered429: limited,
      perSecondLocal: Math.round(perSecond)
    }
  )
}
victim.control.ws.terminate()
finish()
