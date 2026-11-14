#!/usr/bin/env node
// Attacker: external, no paired device, no host key.
// Tries every relay socket and route without a credential: forged/unsigned relay JWTs on the host
// control upgrade, internal-header spoofing, the shared edge's admin/spike/health routes, and path
// and method tricks around the Seal router.
import { createHmac, randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import {
  openSocket,
  relayOrigin,
  wsOrigin,
  report,
  hostOnline,
  newHostKeys,
  sleep
} from '../lib/relay-protocol.mjs'

const origin = relayOrigin()
const ws = wsOrigin(origin)
const b64u = (value) =>
  Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url')

// A live victim host, so "it reached the host object" is distinguishable from "no such host".
const victim = await hostOnline(origin)
const victimId = victim.keys.hostId
const claims = {
  sub: `seal:${victimId}`,
  prof: `seal:${victimId}`,
  relayHostId: victimId,
  purpose: 'host-control',
  aud: 'seal-relay',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 3600
}

async function tryControl(name, headers) {
  const socket = openSocket(`${ws}/v1/host/control`, { headers })
  const opened = await socket.open()
  if (!opened) {
    report(`control upgrade: ${name}`, 'blocked', { http: socket.upgradeStatus })
    return
  }
  // Upgraded: see whether the relay talks to us as a host.
  socket.sendJson({
    type: 'host-hello',
    v: 1,
    relayHostId: victimId,
    assignmentEpoch: 1,
    hostPublicKeyB64: victim.keys.publicKeyB64,
    appVersion: 'x'
  })
  const reply = await socket.nextJson(3000)
  report(`control upgrade: ${name}`, reply?.type === 'host-challenge' ? 'VULNERABLE' : 'blocked', {
    upgraded: true,
    reply,
    close: socket.closed
  })
  socket.ws.terminate()
}

await tryControl('no authorization header', {})
await tryControl('garbage bearer', { authorization: 'Bearer AAAA.BBBB.CCCC' })
await tryControl('alg=none JWT', {
  authorization: `Bearer ${b64u({ alg: 'none', typ: 'JWT' })}.${b64u(claims)}.`
})
await tryControl('alg=None (case) JWT', {
  authorization: `Bearer ${b64u({ alg: 'None' })}.${b64u(claims)}.`
})
{
  // HS256 signed with a guessable key, and with the JWKS text as the HMAC key (key confusion).
  const header = b64u({ alg: 'HS256', typ: 'JWT', kid: 'audit' })
  const body = b64u(claims)
  const keys = ['', 'secret', 'seal-relay']
  const operatorFile = '/tmp/seal-audit3/operator-secrets.json'
  if (existsSync(operatorFile)) {
    keys.push(JSON.parse(readFileSync(operatorFile, 'utf8')).RELAY_JWKS)
  }
  for (const [index, key] of keys.entries()) {
    const signature = createHmac('sha256', key).update(`${header}.${body}`).digest('base64url')
    await tryControl(`HS256 key-confusion #${index}`, {
      authorization: `Bearer ${header}.${body}.${signature}`
    })
  }
}
await tryControl('ES256 header, random signature', {
  authorization: `Bearer ${b64u({ alg: 'ES256', kid: 'audit' })}.${b64u(claims)}.${randomBytes(64).toString('base64url')}`
})
await tryControl('embedded jwk header (self-signed key)', {
  authorization: `Bearer ${b64u({ alg: 'ES256', jwk: { kty: 'EC', crv: 'P-256', x: 'AAAA', y: 'AAAA' } })}.${b64u(claims)}.${randomBytes(64).toString('base64url')}`
})
// Internal headers the Worker sets for its Durable Objects; a client must not be able to set them.
await tryControl('spoofed x-edge-claims / x-edge-kind, no token', {
  'x-edge-kind': 'control',
  'x-edge-claims': JSON.stringify({
    userId: `seal:${victimId}`,
    profileId: `seal:${victimId}`,
    organizationId: '',
    relayHostId: victimId,
    exp: Date.now() + 3600_000
  })
})
// A different (attacker) host's valid token, claiming the victim's id in the hello.
{
  const attacker = await hostOnline(origin, newHostKeys())
  const socket = openSocket(`${ws}/v1/host/control`, {
    headers: { authorization: `Bearer ${attacker.relayToken}` }
  })
  await socket.open()
  socket.sendJson({
    type: 'host-hello',
    v: 1,
    relayHostId: victimId,
    assignmentEpoch: 1,
    hostPublicKeyB64: victim.keys.publicKeyB64,
    appVersion: 'x'
  })
  const reply = await socket.nextJson(3000)
  await socket.waitClosed(2000)
  report(
    'control: attacker token, victim id+key in hello',
    reply?.type === 'host-challenge' ? 'VULNERABLE' : 'blocked',
    { reply, close: socket.closed }
  )
  attacker.control.ws.terminate()
}

// Phone socket carrying spoofed internal headers: must still be treated as an unauthenticated phone.
{
  const socket = openSocket(`${ws}/v1/connect/${victimId}`, {
    headers: {
      'x-edge-kind': 'control',
      'x-edge-conn-id': `${victimId}.0.attacker`,
      'x-edge-claims': '{"relayHostId":"x"}'
    }
  })
  await socket.open()
  socket.sendJson({ type: 'host-hello', v: 1 })
  const reply = await socket.nextJson(3000)
  await socket.waitClosed(3000)
  report(
    'phone socket with spoofed x-edge-* headers',
    reply?.type === 'relay-hello' && reply.ok === false ? 'blocked' : 'VULNERABLE',
    { reply, close: socket.closed }
  )
}

// HTTP routes that exist in the shared edge Worker but must be unreachable through the Seal router.
const routes = [
  ['POST', '/__admin/assign'],
  ['POST', '/__admin/export'],
  ['POST', '/__admin/erase'],
  ['POST', '/__admin/drain'],
  ['GET', '/__health/object'],
  ['GET', '/__spike/info'],
  ['GET', `/__spike/host/${victimId}`],
  ['GET', `/__spike/abort/${victimId}`],
  ['GET', '/__spike/db'],
  ['GET', '/v1/devices'],
  ['POST', '/v1/send'],
  ['POST', '/v1/host/relay-token'],
  ['POST', '/v1/assign'],
  // Path tricks: doubled slashes, dot segments, encoded slashes, case, trailing slash, suffixes.
  ['POST', '//__admin/assign'],
  ['POST', '/v1/../__admin/assign'],
  ['POST', '/v1/connect/..%2f..%2f__admin%2fassign'],
  ['POST', '/v1/host/control/../../../__admin/assign'],
  ['GET', '/V1/DEVICES'],
  ['GET', '/v1/devices/'],
  ['GET', '/v1/devicesX'],
  ['GET', '/v1/devices/../send'],
  ['GET', '/health/../__spike/info'],
  ['GET', '/health?x=1'],
  ['GET', '/v1/host/control?x=1'],
  ['GET', `/v1/connect/${victimId}/extra`],
  ['GET', '/v1/host/data/%2e%2e'],
  ['GET', '/.dev.vars'],
  ['GET', '/.secrets.json'],
  ['GET', '/.well-known/jwks.json'],
  ['OPTIONS', '/v1/send'],
  ['TRACE', '/v1/send'],
  ['GET', '/v1/host/challenge'],
  ['PUT', '/v1/resolve']
]
for (const [method, path] of routes) {
  // fetch() normalizes dot segments, so send the raw path on a socket-level request.
  const response = await rawRequest(method, path)
  const leaked = response.status === 200 && path !== '/health?x=1'
  report(`route ${method} ${path}`, leaked ? 'VULNERABLE' : 'blocked', {
    http: response.status,
    body: response.body.slice(0, 120)
  })
}

async function rawRequest(method, path) {
  const { connect } = await import('node:net')
  const url = new URL(origin)
  return new Promise((resolve) => {
    const socket = connect(Number(url.port), url.hostname, () => {
      socket.write(
        `${method} ${path} HTTP/1.1\r\nHost: ${url.host}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`
      )
    })
    let data = ''
    socket.on('data', (chunk) => {
      data += chunk.toString('latin1')
    })
    socket.on('close', () => {
      const status = Number(/^HTTP\/1\.1 (\d+)/.exec(data)?.[1] ?? 0)
      resolve({ status, body: data.split('\r\n\r\n').slice(1).join('\r\n\r\n') })
    })
    socket.on('error', () => resolve({ status: 0, body: '' }))
    setTimeout(() => socket.destroy(), 5000)
  })
}

victim.control.ws.terminate()
await sleep(100)
process.exit(0)
