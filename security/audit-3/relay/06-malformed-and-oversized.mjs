#!/usr/bin/env node
// Attacker: external (pre-auth cases) and another enrolled relay host (control-socket cases).
// Malformed and oversized HTTP bodies, paths and WebSocket frames. Each must be refused with a
// 4xx or a close frame; after every case the script also checks that the Worker still answers and
// that an unrelated victim host is still seated.
import { connect } from 'node:net'
import { randomBytes } from 'node:crypto'
import {
  createInvite,
  finish,
  freshSourceIp,
  hostOnline,
  openSocket,
  phoneOpen,
  postJson,
  relayOrigin,
  report,
  setSourceIp,
  sleep,
  splice,
  wsOrigin
} from '../lib/relay-protocol.mjs'

// The Worker's caps: host-auth and relay JSON bodies, push bodies, and a stalled body's deadline.
const RELAY_BODY_MAX_BYTES = 4096
const PUSH_BODY_MAX_BYTES = 16 * 1024
const BODY_READ_DEADLINE_MS = 10_000
const origin = relayOrigin()
const url = new URL(origin)
setSourceIp(freshSourceIp())
const victim = await hostOnline(origin)

async function alive() {
  const health = await fetch(`${origin}/health`)
    .then((r) => r.status)
    .catch(() => 0)
  return { health, victimControlOpen: victim.control.closed === null }
}
async function check(name, run, isBad) {
  setSourceIp(freshSourceIp())
  let outcome
  try {
    outcome = await run()
  } catch (error) {
    outcome = { error: String(error) }
  }
  const after = await alive()
  const bad =
    after.health !== 200 || !after.victimControlOpen || 'error' in outcome || isBad(outcome)
  report(name, bad ? 'VULNERABLE' : 'blocked', { ...outcome, ...after })
}
const refused = (outcome) => outcome.http < 400 || outcome.http >= 500

// Raw HTTP so that Content-Length, chunking and the path are exactly what we choose. The last
// body chunk is held back for `holdLastMs`: an answer that arrives meanwhile shows the server
// refused without waiting for (and buffering) the whole body. So does the server dropping the
// connection meanwhile: a reset can discard the response it had already written.
function raw(head, bodyChunks = [], { timeoutMs = 20000, holdLastMs = 0 } = {}) {
  return new Promise((resolve) => {
    const started = Date.now()
    const socket = connect(Number(url.port), url.hostname)
    let data = ''
    let sent = 0
    let answeredAt = null
    let lastChunkAt = null
    let gaveUp = false
    socket.on('connect', async () => {
      socket.write(head)
      for (const [index, chunk] of bodyChunks.entries()) {
        if (index === bodyChunks.length - 1) {
          const holdUntil = Date.now() + holdLastMs
          while (Date.now() < holdUntil && answeredAt === null) {
            await sleep(20)
          }
        }
        if (socket.destroyed || answeredAt !== null) {
          break
        }
        if (index === bodyChunks.length - 1) {
          lastChunkAt = Date.now() - started
        }
        sent += chunk.length
        if (!socket.write(chunk)) {
          await Promise.race([new Promise((r) => socket.once('drain', r)), sleep(holdLastMs)])
        }
      }
    })
    socket.on('data', (chunk) => {
      data += chunk.toString('latin1')
      if (data.includes('\r\n\r\n')) {
        answeredAt ??= Date.now() - started
        socket.end()
      }
    })
    socket.on('close', () =>
      resolve({
        http: Number(/^HTTP\/1\.1 (\d+)/.exec(data)?.[1] ?? 0),
        bytesSent: sent,
        answeredAtMs: answeredAt,
        answeredBeforeBodyEnd: answeredAt !== null && lastChunkAt === null,
        droppedBeforeBodyEnd: answeredAt === null && lastChunkAt === null && !gaveUp
      })
    )
    socket.on('error', () => {})
    setTimeout(() => {
      gaveUp = true
      socket.destroy()
    }, timeoutMs)
  })
}
const post = (path, extra = '') =>
  `POST ${path} HTTP/1.1\r\nHost: ${url.host}\r\ncontent-type: application/json\r\ncf-connecting-ip: ${freshSourceIp()}\r\n${extra}`
function chunked(totalBytes, pieceBytes = 1024 * 1024) {
  const piece = Buffer.alloc(pieceBytes, 0x20)
  const frames = []
  for (let sent = 0; sent < totalBytes; sent += pieceBytes) {
    frames.push(
      Buffer.concat([Buffer.from(`${pieceBytes.toString(16)}\r\n`), piece, Buffer.from('\r\n')])
    )
  }
  frames.push(Buffer.from('0\r\n\r\n'))
  return frames
}

// ---------------- HTTP bodies ----------------
// A sender that announces a body and then stalls: judged at the end, it takes the whole deadline.
const stalled = raw(post('/v1/host/challenge', 'content-length: 200\r\n\r\n'), [
  Buffer.from('{"v":1,')
])
await check(
  'challenge: 17 KiB body with honest Content-Length',
  async () => {
    const response = await postJson(
      origin,
      '/v1/host/challenge',
      `{"v":1,"hostPublicKeyB64":"${'A'.repeat(17 * 1024)}"}`
    )
    return { http: response.status }
  },
  (o) => o.http !== 413
)
// 8 MiB is 2048x the 4 KiB cap; the refusal lands before the body ends, so no huge body is buffered.
// Only the early refusal matters: flooding a half-closed socket makes workerd report the lost
// response as 413, 500 or a reset, so the judge accepts a reset or any non-2xx before the last chunk.
const accepted = (o) => o.http >= 200 && o.http < 400
const bufferedWholeBody = (o) => !(o.answeredBeforeBodyEnd || o.droppedBeforeBodyEnd) || accepted(o)
await check(
  'challenge: 8 MiB chunked body, no Content-Length (unauthenticated)',
  () =>
    raw(
      post('/v1/host/challenge', 'transfer-encoding: chunked\r\n\r\n'),
      chunked(8 * 1024 * 1024),
      {
        holdLastMs: 3000
      }
    ),
  bufferedWholeBody
)
for (const [path, maxBytes] of [
  ['/v1/host/session', RELAY_BODY_MAX_BYTES],
  ['/v1/resolve', RELAY_BODY_MAX_BYTES],
  ['/v1/assign', RELAY_BODY_MAX_BYTES],
  ['/v1/host/relay-token', RELAY_BODY_MAX_BYTES],
  ['/v1/devices', PUSH_BODY_MAX_BYTES],
  ['/v1/send', PUSH_BODY_MAX_BYTES]
]) {
  // One byte over the route's cap, in small chunks and without a Content-Length to pre-check.
  const authorization = path.endsWith('/assign') ? victim.relayToken : victim.session.sessionToken
  await check(
    `${path}: ${maxBytes + 1} byte chunked body, no Content-Length`,
    () =>
      raw(
        post(path, `authorization: Bearer ${authorization}\r\ntransfer-encoding: chunked\r\n\r\n`),
        [
          ...chunked(maxBytes, maxBytes / 4).slice(0, -1),
          Buffer.from('1\r\n \r\n'),
          Buffer.from('0\r\n\r\n')
        ],
        { holdLastMs: 3000 }
      ),
    bufferedWholeBody
  )
}
await check(
  'resolve: Content-Length smaller than the body',
  () =>
    raw(
      post('/v1/resolve', 'content-length: 10\r\n\r\n'),
      [Buffer.from(`{"v":1,"relayHostId":"${'A'.repeat(16)}","resumeToken":"x"}`)],
      { timeoutMs: 4000 }
    ),
  (o) => o.http !== 400
)
const bodies = {
  'not JSON': 'hello',
  empty: '',
  'JSON null': 'null',
  array: '[1,2,3]',
  'nesting 100k deep': `${'['.repeat(100000)}${']'.repeat(100000)}`.slice(0, 15000),
  '__proto__ key': '{"v":1,"__proto__":{"admin":true},"hostPublicKeyB64":"AAAA"}',
  'constructor key': '{"v":1,"constructor":{"prototype":{"x":1}},"hostPublicKeyB64":"AAAA"}',
  'number as key': '{"v":1,"hostPublicKeyB64":12345}',
  'non-canonical base64 key': `{"v":1,"hostPublicKeyB64":"${'/'.repeat(42)}/="}`,
  'duplicate keys': `{"v":1,"hostPublicKeyB64":"x","hostPublicKeyB64":"${randomBytes(32).toString('base64')}"}`,
  'utf-16 surrogates': '{"v":1,"hostPublicKeyB64":"\\ud800\\udfff"}',
  'huge number': '{"v":1e999,"hostPublicKeyB64":"x"}'
}
for (const [label, body] of Object.entries(bodies)) {
  for (const path of ['/v1/host/challenge', '/v1/host/session', '/v1/resolve']) {
    await check(
      `${path}: ${label}`,
      async () => ({ http: (await postJson(origin, path, body)).status }),
      refused
    )
  }
}

// ---------------- paths ----------------
// [path, the refusal it must get]: a mangled percent-escape is the client's error (400).
for (const { path, expected } of [
  { path: '/v1/host/data/%E0%A4%A', expected: [400] },
  { path: '/v1/host/data/%', expected: [400] },
  { path: '/v1/host/data/%ZZ', expected: [400] },
  { path: '/v1/connect/%E0%A4%A', expected: [429] },
  { path: `/v1/host/data/${'A'.repeat(4000)}`, expected: [404, 429] },
  { path: '/v1/host/data/a.b.c.d.e', expected: [404, 429] },
  { path: `/v1/host/data/${'A'.repeat(16)}.99999999999999999999.x`, expected: [404, 429] },
  { path: `/v1/host/data/${'A'.repeat(16)}.-1.x`, expected: [404, 429] },
  { path: `/v1/host/data/${'A'.repeat(16)}.1e0.x`, expected: [404, 429] }
]) {
  await check(
    `upgrade ${path.slice(0, 60)}`,
    async () => {
      const socket = openSocket(`${wsOrigin(origin)}${path}`)
      await socket.open()
      socket.ws.terminate()
      return { upgrade: socket.upgradeStatus ?? 101 }
    },
    (o) => !expected.includes(o.upgrade)
  )
}
await check(
  'DELETE /v1/devices/%E0%A4%A with a valid host session',
  async () => {
    const response = await fetch(`${origin}/v1/devices/%E0%A4%A`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${victim.session.sessionToken}` },
      signal: AbortSignal.timeout(6000)
    }).catch((error) => ({ status: `no response (${error.name})` }))
    return { http: response.status }
  },
  (o) => o.http !== 400
)

// ---------------- phone socket before authentication ----------------
const phoneFrames = {
  'binary first frame': Buffer.from([0, 1, 2, 3]),
  'empty text': '',
  'JSON null': 'null',
  'JSON array': '[]',
  'type only': '{"type":"relay-auth"}',
  'extra keys': JSON.stringify({
    type: 'relay-auth',
    v: 1,
    mode: 'connect',
    credential: 'A'.repeat(43),
    admin: true
  }),
  __proto__:
    '{"type":"relay-auth","v":1,"mode":"connect","credential":"x","__proto__":{"credential":"y"}}',
  'nesting 500k deep': '['.repeat(500000),
  '900 KiB of JSON string': JSON.stringify({
    type: 'relay-auth',
    v: 1,
    mode: 'connect',
    credential: 'A'.repeat(900 * 1024)
  }),
  '4 MiB text frame': 'A'.repeat(4 * 1024 * 1024),
  '40 MiB text frame': 'A'.repeat(40 * 1024 * 1024),
  '40 MiB binary frame': Buffer.alloc(40 * 1024 * 1024)
}
// Any pre-auth frame ends the socket: a refusal, never a hello, never a socket left parked.
const notClosed = (o) => o.hello?.ok === true || !o.close
for (const [label, frame] of Object.entries(phoneFrames)) {
  await check(
    `phone pre-auth: ${label}`,
    async () => {
      const phone = await phoneOpen(origin, victim.keys.hostId)
      phone.ws.send(frame)
      const hello = await phone.nextJson(8000).catch(() => 'unparseable')
      return { hello, close: await phone.waitClosed(8000) }
    },
    notClosed
  )
}
await check(
  'phone pre-auth: invalid UTF-8 in a text frame',
  async () => {
    const phone = await phoneOpen(origin, victim.keys.hostId)
    // FIN + text opcode, masked, payload 0xC3 0x28 (invalid UTF-8).
    phone.ws._socket.write(Buffer.from([0x81, 0x82, 0, 0, 0, 0, 0xc3, 0x28]))
    return { close: await phone.waitClosed(4000) }
  },
  notClosed
)
await check(
  'phone pre-auth: reserved opcode / RSV bits',
  async () => {
    const phone = await phoneOpen(origin, victim.keys.hostId)
    phone.ws._socket.write(Buffer.from([0xf3, 0x80, 0, 0, 0, 0]))
    return { close: await phone.waitClosed(4000) }
  },
  notClosed
)
await check(
  'phone pre-auth: declared 2^63-byte frame, never sent',
  async () => {
    const phone = await phoneOpen(origin, victim.keys.hostId)
    phone.ws._socket.write(
      Buffer.from([0x82, 0xff, 0x7f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0])
    )
    return { close: await phone.waitClosed(6000) }
  },
  notClosed
)

// ---------------- control socket (attacker is an enrolled host) ----------------
setSourceIp(freshSourceIp())
const mallory = await hostOnline(origin)
const controlFrames = {
  'unknown type': '{"type":"__proto__"}',
  'type is an object': '{"type":{"toString":1}}',
  'invite-create with 10 KiB reqId': JSON.stringify({
    type: 'invite-create',
    reqId: 'r'.repeat(10240),
    relayDeviceId: 'd'
  }),
  'device-revoke with SQL metacharacters': JSON.stringify({
    type: 'device-revoke',
    reqId: "1'; DROP TABLE relay_devices;--",
    relayDeviceId: "x' OR '1'='1"
  }),
  'install with nested authorization': JSON.stringify({
    type: 'device-credential-install',
    v: 1,
    reqId: 'a',
    relayDeviceId: 'b',
    newResumeTokenHash: 'A'.repeat(43),
    authorization: { mode: 'relay-basis', basisConnId: { $ne: null } }
  }),
  'auth-refresh with garbage': JSON.stringify({ type: 'auth-refresh', relayJwt: 'x.y.z' }),
  'host-hello again (wrong phase)': JSON.stringify({ type: 'host-hello', v: 1 }),
  'binary frame': Buffer.alloc(1024),
  'nesting 200k deep': '['.repeat(200000),
  '1 MiB + 1 text frame': 'A'.repeat(1024 * 1024 + 1)
}
// Mallory may lose her own control socket; what counts is the Worker and the victim (check()).
for (const [label, frame] of Object.entries(controlFrames)) {
  await check(
    `control (mallory): ${label}`,
    async () => {
      if (mallory.control.closed) {
        return { skipped: 'control already closed', close: mallory.control.closed }
      }
      mallory.control.ws.send(frame)
      const reply = await mallory.control.nextJson(1500).catch(() => 'unparseable')
      return {
        reply: typeof reply === 'object' ? reply : String(reply).slice(0, 80),
        close: mallory.control.closed
      }
    },
    () => false
  )
}
// SQL metacharacters must have been bound, not interpolated: mallory's own store still works.
await check(
  'control (mallory): store intact after SQL metacharacters',
  async () => {
    const again = await hostOnline(origin, mallory.keys)
    const invite = await createInvite(again.control)
    again.control.ws.terminate()
    return { inviteStillMintable: Boolean(invite.inviteToken) }
  },
  (o) => !o.inviteStillMintable
)

// ---------------- splice frames ----------------
{
  const invite = await createInvite(victim.control)
  const live = await splice(origin, victim, invite.inviteToken)
  await check(
    'splice: 8 MiB frame is forwarded',
    async () => {
      live.phone.ws.send(Buffer.alloc(8 * 1024 * 1024, 1))
      const got = await live.data.next(15000)
      return { forwardedBytes: got?.length ?? 0 }
    },
    (o) => o.forwardedBytes !== 8 * 1024 * 1024
  )
  await check(
    'splice: 8 MiB + 1 frame closes both legs 1009',
    async () => {
      live.phone.ws.send(Buffer.alloc(8 * 1024 * 1024 + 1, 1))
      return {
        phoneClose: await live.phone.waitClosed(8000),
        dataClose: await live.data.waitClosed(8000)
      }
    },
    (o) => o.phoneClose?.code !== 1009
  )
}

await check(
  'challenge: body that stalls after 7 bytes',
  () => stalled,
  (o) => refused(o) || o.answeredAtMs > BODY_READ_DEADLINE_MS + 3000
)
finish()
