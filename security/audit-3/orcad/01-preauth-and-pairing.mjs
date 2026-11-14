#!/usr/bin/env node
// Attacks the headless Seal server (orcad, `seal serve`) on its WS/HTTP port (default 6768).
// Personas: LAN attacker with no paired device, and a brute-forcer of the pairing credential.
// Start a local orcad first, e.g.:
//   ORCA_SERVE_RUNTIME=orcad node <orcad-node-build>/orcad.js --bind 127.0.0.1 --port 6768 --mobile-pairing
// then: ORCAD_URL=http://127.0.0.1:6768 node security/audit-3/orcad/01-preauth-and-pairing.mjs
// Everything here is read-only probing: it never pairs and never runs an RPC method.
import { WebSocket } from '../lib/deps.mjs'
import { report } from '../lib/relay-protocol.mjs'

const base = process.env.ORCAD_URL ?? 'http://127.0.0.1:6768'
const wsBase = base.replace(/^http/, 'ws')

async function reachable() {
  try {
    await fetch(base, { signal: AbortSignal.timeout(2000) })
    return true
  } catch (error) {
    return error.name !== 'TypeError' && !/ECONNREFUSED/.test(String(error))
  }
}
if (!(await reachable())) {
  report('orcad reachable', 'skipped', {
    reason: `nothing answering at ${base}; start orcad (see header)`
  })
  process.exit(0)
}

// ---- HTTP surface before any auth ----
for (const [label, path, method] of [
  ['root', '/', 'GET'],
  ['rpc-looking path', '/rpc', 'POST'],
  ['devices', '/v1/devices', 'GET'],
  ['pairing offer mint', '/pairing/offer', 'POST'],
  ['traversal', '/../../etc/passwd', 'GET'],
  ['options probe', '/', 'OPTIONS'],
  ['well-known', '/.well-known/seal', 'GET']
]) {
  try {
    const response = await fetch(`${base}${path}`, { method, signal: AbortSignal.timeout(3000) })
    const body = (await response.text()).slice(0, 120)
    // Anything that leaks RPC results or device data unauthenticated is a finding.
    const leak = /deviceToken|terminal|session|registrationId|"ok":true/.test(body)
    report(`http ${method} ${path} (${label})`, leak ? 'VULNERABLE' : 'info', {
      status: response.status,
      bodyStart: body.replace(/\s+/g, ' ')
    })
  } catch (error) {
    report(`http ${method} ${path} (${label})`, 'info', { error: error.name })
  }
}

// ---- header spoofing of the source address ----
// The guard classifies the TCP peer, not a header; from loopback these all connect, but on a
// public bind they prove whether XFF can forge a LAN peer.
for (const header of ['x-forwarded-for', 'x-real-ip', 'cf-connecting-ip', 'forwarded']) {
  await new Promise((resolve) => {
    const ws = new WebSocket(wsBase, {
      headers: { [header]: '192.168.1.50' },
      handshakeTimeout: 3000
    })
    const timer = setTimeout(() => {
      ws.terminate()
      report(`ws upgrade with spoofed ${header}`, 'info', {
        result: 'open, awaiting handshake (expected: peer IP governs, header ignored)'
      })
      resolve()
    }, 2500)
    ws.on('unexpected-response', (_req, res) => {
      clearTimeout(timer)
      report(`ws upgrade with spoofed ${header}`, 'info', { httpStatus: res.statusCode })
      resolve()
    })
    ws.on('error', () => {
      clearTimeout(timer)
      report(`ws upgrade with spoofed ${header}`, 'info', { result: 'refused/destroyed' })
      resolve()
    })
  })
}

// ---- RPC before completing the E2EE handshake ----
await new Promise((resolve) => {
  const ws = new WebSocket(wsBase, { handshakeTimeout: 3000 })
  let answered = false
  const finish = (verdict, detail) => {
    if (answered) {
      return
    }
    answered = true
    try {
      ws.terminate()
    } catch {}
    report('plaintext RPC before e2ee handshake', verdict, detail)
    resolve()
  }
  ws.on('open', () => {
    // Skip the hello/auth and send a privileged RPC directly.
    ws.send(
      JSON.stringify({ type: 'rpc', id: '1', method: 'machineHost.exec', params: { script: 'id' } })
    )
    ws.send(JSON.stringify({ id: '2', method: 'terminal.create', params: {} }))
  })
  ws.on('message', (data) => {
    const text = data.toString().slice(0, 200)
    finish(/uid=|"stdout"|terminalId|"ok":true/.test(text) ? 'VULNERABLE' : 'blocked', {
      reply: text.replace(/\s+/g, ' ')
    })
  })
  ws.on('close', (code, reason) =>
    finish('blocked', { close: { code, reason: reason.toString() } })
  )
  ws.on('error', (error) => finish('blocked', { error: error.message }))
  setTimeout(() => finish('blocked', { result: 'no RPC reply before handshake timeout' }), 4000)
})

// ---- pairing credential brute force (entropy demonstration) ----
// The pairing secret is a 192-bit random token (randomBytes(24) hex), carried in the QR URL.
// This does not brute-force it; it records why that is infeasible and probes for a lockout.
{
  const bits = 192
  const guessesPerSecond = 1000 // optimistic for a single LAN socket honoring the 64-conn cap
  const seconds = 2 ** bits / guessesPerSecond
  report('pairing token brute force', 'blocked', {
    entropyBits: bits,
    form: 'randomBytes(24).toString(hex), 48 hex chars in the QR URL',
    expectedSecondsToGuess: seconds.toExponential(2),
    note: 'infeasible; token entropy, not a short PIN, is the control'
  })
  // Is there a lockout on repeated bad auth from one source? (recon: only a 3/60s UI callback, no lockout)
  let refusedAt = null
  for (let i = 0; i < 12; i++) {
    const ok = await new Promise((resolve) => {
      const ws = new WebSocket(wsBase, { handshakeTimeout: 2500 })
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'e2ee_hello' }))
        ws.send(JSON.stringify({ type: 'e2ee_auth', deviceToken: 'f'.repeat(48) }))
      })
      ws.on('message', () => {
        ws.terminate()
        resolve(true)
      })
      ws.on('close', () => resolve(true))
      ws.on('error', () => resolve(false))
      setTimeout(() => {
        try {
          ws.terminate()
        } catch {}
        resolve(true)
      }, 2000)
    })
    if (!ok) {
      refusedAt ??= i + 1
    }
  }
  report(
    'lockout after repeated bad pairing-token auth',
    refusedAt
      ? 'blocked (connections refused)'
      : 'info (no lockout; relies on 192-bit entropy + 64-conn cap)',
    { firstRefusalAtAttempt: refusedAt }
  )
}
process.exit(0)
