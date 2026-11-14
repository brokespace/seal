// A from-scratch client for the Seal relay's wire protocol, written for attacking it: every step
// is exposed so scripts can skip, repeat or corrupt it. Mirrors what a real host (desktop/orcad)
// and a real phone send; nothing here imports product code.
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { WebSocket, nacl } from './deps.mjs'

export { WebSocket, nacl }
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
export const b64 = (bytes) => Buffer.from(bytes).toString('base64')
export const b64url = (bytes) => Buffer.from(bytes).toString('base64url')
export const sha256B64url = (value) => createHash('sha256').update(value).digest('base64url')
export const randomToken = () => b64url(randomBytes(32))

export function relayState(stateDir = process.env.SEAL_AUDIT_STATE_DIR ?? '/tmp/seal-audit3') {
  return JSON.parse(readFileSync(`${stateDir}/relay.json`, 'utf8'))
}

export function relayOrigin() {
  return process.env.SEAL_AUDIT_RELAY_ORIGIN ?? relayState().origin
}

export function wsOrigin(origin) {
  return origin.replace(/^http/, 'ws')
}

export function newHostKeys() {
  const pair = nacl.box.keyPair()
  return { ...pair, publicKeyB64: b64(pair.publicKey), hostId: hostIdOf(pair.publicKey) }
}

export function hostIdOf(publicKey) {
  return sha256B64url(Buffer.from(publicKey)).slice(0, 16)
}

// Locally nothing sits in front of workerd, so the Worker believes a client-sent cf-connecting-ip.
// In production Cloudflare overwrites it. Scripts use this only to stand in for "a request from
// another address" (several attackers, or one attacker rotating inside an IPv6 /64).
let sourceIp = process.env.SEAL_AUDIT_SOURCE_IP ?? null
export function setSourceIp(ip) {
  sourceIp = ip
}
export function sourceHeaders() {
  return sourceIp ? { 'cf-connecting-ip': sourceIp } : {}
}
let ipCounter = 0
export function freshSourceIp() {
  ipCounter++
  return `198.51.${Math.floor(Math.random() * 250)}.${(ipCounter % 250) + 1}`
}

export async function postJson(origin, path, body, headers = {}) {
  const response = await fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...sourceHeaders(), ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  })
  const text = await response.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {}
  return { status: response.status, json, text, headers: response.headers }
}

// The challenge plaintext is `<domain>\0 | uint32 len | transcript | 32-byte secret`.
function answerChallenge(domain, challenge, keys, ephemeralKeyB64) {
  const plaintext = nacl.box.open(
    Buffer.from(challenge.ciphertextB64, 'base64'),
    Buffer.from(challenge.nonceB64, 'base64'),
    Buffer.from(ephemeralKeyB64, 'base64'),
    keys.secretKey
  )
  if (!plaintext) {
    throw new Error('challenge did not decrypt')
  }
  const prefix = Buffer.from(`${domain.replace('proof', 'challenge')}\0`)
  const length = Buffer.from(plaintext).readUInt32BE(prefix.length)
  const transcript = plaintext.slice(prefix.length + 4, prefix.length + 4 + length)
  const secret = plaintext.slice(prefix.length + 4 + length)
  return createHmac('sha256', secret)
    .update(Buffer.concat([Buffer.from(`${domain}\0ack\0`), transcript]))
    .digest('base64')
}

// POST /v1/host/challenge + /v1/host/session: proves the X25519 key, returns a 24 h session token.
export async function hostSession(origin, keys) {
  const challenge = await postJson(origin, '/v1/host/challenge', {
    v: 1,
    hostPublicKeyB64: keys.publicKeyB64
  })
  if (challenge.status !== 200) {
    throw new Error(`challenge ${challenge.status}`)
  }
  const proofB64 = answerChallenge(
    'orca-push-host-proof/v1',
    challenge.json,
    keys,
    challenge.json.gatewayEphemeralPublicKeyB64
  )
  const session = await postJson(origin, '/v1/host/session', {
    v: 1,
    challengeId: challenge.json.challengeId,
    proofB64
  })
  if (session.status !== 200) {
    throw new Error(`session ${session.status}`)
  }
  return { ...session.json, challenge: challenge.json, proofB64 }
}

export async function relayToken(origin, sessionToken, keys) {
  const response = await postJson(
    origin,
    '/v1/host/relay-token',
    { relayHostId: keys.hostId, hostPublicKeyB64: keys.publicKeyB64 },
    { authorization: `Bearer ${sessionToken}` }
  )
  if (response.status !== 200) {
    throw new Error(`relay-token ${response.status}`)
  }
  return response.json
}

export async function assign(origin, token, hostId) {
  const response = await postJson(
    origin,
    '/v1/assign',
    { v: 1, relayHostId: hostId },
    { authorization: `Bearer ${token}` }
  )
  if (response.status !== 200) {
    throw new Error(`assign ${response.status}`)
  }
  return response.json
}

// A WebSocket with a message queue, so scripts can await frames in order.
export function openSocket(url, options = {}) {
  const ws = new WebSocket(url, {
    perMessageDeflate: false,
    ...options,
    headers: { ...sourceHeaders(), ...options.headers }
  })
  const queue = []
  const waiters = []
  const state = { ws, closed: null, opened: false, upgradeStatus: null }
  ws.on('message', (data, isBinary) => {
    const message = isBinary ? Buffer.from(data) : data.toString('utf8')
    const waiter = waiters.shift()
    if (waiter) {
      waiter.resolve(message)
    } else {
      queue.push(message)
    }
  })
  ws.on('unexpected-response', (_request, response) => {
    state.upgradeStatus = response.statusCode
    response.resume()
    state.closed ??= { code: -1, reason: `http ${response.statusCode}` }
    for (const waiter of waiters.splice(0)) {
      waiter.resolve(null)
    }
  })
  ws.on('close', (code, reason) => {
    state.closed ??= { code, reason: reason.toString() }
    for (const waiter of waiters.splice(0)) {
      waiter.resolve(null)
    }
  })
  ws.on('error', () => {})
  state.open = (timeoutMs = 8000) =>
    new Promise((resolve) => {
      if (ws.readyState === WebSocket.OPEN) {
        return resolve(true)
      }
      const timer = setTimeout(() => {
        state.closed ??= { code: -2, reason: 'upgrade timed out' }
        ws.terminate()
        resolve(false)
      }, timeoutMs)
      const settle = (value) => {
        clearTimeout(timer)
        resolve(value)
      }
      ws.once('open', () => {
        state.opened = true
        settle(true)
      })
      ws.once('close', () => settle(false))
      ws.once('unexpected-response', () => settle(false))
      ws.once('error', () => settle(false))
    })
  // Next frame, or null when the socket closes or the timeout passes.
  state.next = (timeoutMs = 5000) =>
    new Promise((resolve) => {
      if (queue.length > 0) {
        return resolve(queue.shift())
      }
      if (state.closed) {
        return resolve(null)
      }
      const waiter = {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        }
      }
      const timer = setTimeout(() => {
        const index = waiters.indexOf(waiter)
        if (index !== -1) {
          waiters.splice(index, 1)
        }
        resolve(null)
      }, timeoutMs)
      waiters.push(waiter)
    })
  state.nextJson = async (timeoutMs) => {
    const message = await state.next(timeoutMs)
    return typeof message === 'string' ? JSON.parse(message) : message
  }
  state.sendJson = (payload) => ws.send(JSON.stringify(payload))
  state.waitClosed = async (timeoutMs = 5000) => {
    const end = Date.now() + timeoutMs
    while (!state.closed && Date.now() < end) {
      await sleep(20)
    }
    return state.closed
  }
  return state
}

// Host control socket through hello and proof. Returns the socket and the hello-ack.
export async function controlConnect(origin, token, keys, assignmentEpoch, extra = {}) {
  const socket = openSocket(`${wsOrigin(origin)}/v1/host/control`, {
    headers: {
      authorization: `Bearer ${token}`,
      'x-orca-host-capabilities': 'pending-conn-details',
      ...extra.headers
    }
  })
  if (!(await socket.open())) {
    throw new Error(`control upgrade refused: ${socket.upgradeStatus}`)
  }
  socket.sendJson({
    type: 'host-hello',
    v: 1,
    relayHostId: keys.hostId,
    assignmentEpoch,
    hostPublicKeyB64: keys.publicKeyB64,
    appVersion: 'audit-3',
    ...extra.hello
  })
  const challenge = await socket.nextJson()
  if (challenge?.type !== 'host-challenge') {
    throw new Error(`no host-challenge: ${JSON.stringify(challenge ?? socket.closed)}`)
  }
  const proofB64 = answerChallenge(
    'orca-relay-host-proof/v1',
    challenge,
    keys,
    challenge.relayEphemeralPublicKeyB64
  )
  socket.sendJson({ type: 'host-challenge-ack', challengeId: challenge.challengeId, proofB64 })
  const ack = await socket.nextJson()
  if (ack?.type !== 'host-hello-ack') {
    throw new Error(`no host-hello-ack: ${JSON.stringify(ack ?? socket.closed)}`)
  }
  return { socket, ack, challenge, proofB64 }
}

// Everything a host does to come online: session, relay token, assignment, control socket.
export async function hostOnline(origin, keys = newHostKeys()) {
  const session = await hostSession(origin, keys)
  const token = await relayToken(origin, session.sessionToken, keys)
  const assignment = await assign(origin, token.relayToken, keys.hostId)
  const control = await controlConnect(origin, token.relayToken, keys, assignment.assignmentEpoch)
  return {
    keys,
    session,
    relayToken: token.relayToken,
    assignment,
    control: control.socket,
    ack: control.ack
  }
}

export async function controlRequest(control, type, body, replyType, timeoutMs = 5000) {
  const reqId = randomUUID()
  control.sendJson({ type, reqId, ...body })
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    const reply = await control.nextJson(end - Date.now())
    if (!reply) {
      return null
    }
    if (reply.reqId === reqId && (reply.type === replyType || reply.type === 'control-error')) {
      return reply
    }
    control.unhandled ??= []
    control.unhandled.push(reply)
  }
  return null
}

export async function createInvite(control, relayDeviceId = randomUUID()) {
  const reply = await controlRequest(control, 'invite-create', { relayDeviceId }, 'invite-created')
  if (reply?.type !== 'invite-created') {
    throw new Error(`invite-create failed: ${JSON.stringify(reply)}`)
  }
  return { relayDeviceId, inviteToken: reply.inviteToken, expiresAt: reply.expiresAt }
}

// Installs a resume credential straight from the host ("authenticated-direct").
export async function installResumeCredential(control, relayDeviceId = randomUUID()) {
  const resumeToken = randomToken()
  const reply = await controlRequest(
    control,
    'device-credential-install',
    {
      v: 1,
      relayDeviceId,
      newResumeTokenHash: sha256B64url(resumeToken),
      authorization: { mode: 'authenticated-direct', directAuthId: randomUUID() }
    },
    'device-credential-installed'
  )
  if (reply?.type !== 'device-credential-installed') {
    throw new Error(`install failed: ${JSON.stringify(reply)}`)
  }
  return { relayDeviceId, resumeToken }
}

export async function revokeDevice(control, relayDeviceId) {
  return controlRequest(control, 'device-revoke', { relayDeviceId }, 'device-revoked')
}

// Phone leg: upgrade, then relay-auth as the first frame.
export async function phoneOpen(origin, hostId, options = {}) {
  const socket = openSocket(`${wsOrigin(origin)}/v1/connect/${hostId}`, options)
  await socket.open()
  return socket
}

export function relayAuthFrame(credential) {
  return JSON.stringify({ type: 'relay-auth', v: 1, mode: 'connect', credential })
}

// The host's answer to a conn-open: a data socket presenting the ticket.
export async function dataAttach(origin, open, generation) {
  const socket = openSocket(`${wsOrigin(origin)}/v1/host/data/${encodeURIComponent(open.connId)}`)
  if (!(await socket.open())) {
    throw new Error(`data upgrade refused: ${socket.upgradeStatus}`)
  }
  socket.sendJson({ type: 'host-data-auth', v: 1, connTicket: open.connTicket, generation })
  return socket
}

// Waits for the next conn-open on a control socket (skipping pings).
export async function nextConnOpen(control, timeoutMs = 5000) {
  const stashed = (control.unhandled ?? []).findIndex((m) => m?.type === 'conn-open')
  if (stashed !== -1) {
    return control.unhandled.splice(stashed, 1)[0]
  }
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    const message = await control.nextJson(end - Date.now())
    if (!message) {
      return null
    }
    if (message.type === 'conn-open') {
      return message
    }
  }
  return null
}

// A full spliced connection: phone authenticates, host attaches, phone gets relay-hello.
export async function splice(origin, host, credential) {
  const phone = await phoneOpen(origin, host.keys.hostId)
  phone.ws.send(relayAuthFrame(credential))
  const open = await nextConnOpen(host.control)
  if (!open) {
    return { phone, open: null, data: null, hello: await phone.nextJson(1000) }
  }
  const data = await dataAttach(origin, open, host.ack.generation)
  const hello = await phone.nextJson()
  return { phone, open, data, hello }
}

export function report(name, verdict, detail = {}) {
  console.log(JSON.stringify({ check: name, verdict, ...detail }))
}
