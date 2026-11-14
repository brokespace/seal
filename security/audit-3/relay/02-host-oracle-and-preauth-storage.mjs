#!/usr/bin/env node
// Attacker: external, no paired device, no host key.
// 1. Host-id oracle: /v1/resolve and /v1/connect must not tell an anonymous caller whether a host
//    id is enrolled, assigned or live.
// 2. Unauthenticated durable writes: no id or key the caller invents may create a Durable Object,
//    and a challenge flood on a known host's public key may not pile up rows.
// 3. The per-source limits hold for a caller rotating addresses inside one IPv6 /64.
// The storage checks read the relay's persisted state, so they need lib/local-relay.mjs (or a
// relay started with a `persistDir` in relay.json).
import { randomBytes } from 'node:crypto'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  enrolledHostKeys,
  finish,
  freshSourceIp,
  hostChallenge,
  hostOnline,
  installResumeCredential,
  newHostKeys,
  openSocket,
  phoneAttempt,
  postJson,
  relayOrigin,
  relayState,
  report,
  setSourceIp,
  sleep,
  sourceHeaders,
  wsOrigin
} from '../lib/relay-protocol.mjs'

const N = Number(process.env.N ?? 40)
const CHALLENGE_TTL_MS = 10_000
const MAX_PENDING_CHALLENGES = 8
const origin = relayOrigin()
const state = relayState()
const randomHostId = () => randomBytes(12).toString('base64url')

// What the Worker stored, per Durable Object class. Miniflare keeps one SQLite file per object it
// ever addressed, so `objects` counts objects touched and `withTables` those holding Worker data.
function objects(className) {
  const dir = join(state.persistDir, 'v3', 'do', `seal-relay-${className}`)
  let files = []
  try {
    files = readdirSync(dir).filter(
      (name) => name.endsWith('.sqlite') && name !== 'metadata.sqlite'
    )
  } catch {}
  let withTables = 0
  let challengeRows = 0
  for (const name of files) {
    try {
      const db = new DatabaseSync(join(dir, name), { readOnly: true })
      // Miniflare keeps its own bookkeeping table in every local object; only the Worker's count.
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((r) => r.name)
        .filter((table) => !table.startsWith('_cf_') && !table.startsWith('__miniflare'))
      if (tables.length > 0) {
        withTables++
      }
      if (tables.includes('challenges')) {
        challengeRows += Number(db.prepare('SELECT count(*) AS n FROM challenges').get().n)
      }
      db.close()
    } catch {}
  }
  return { objects: files.length, withTables, challengeRows }
}
const stored = () => ({
  host: objects('SealHostRelay'),
  splice: objects('SpliceRelay'),
  push: objects('SealPushHost'),
  mcp: objects('SealMcpTunnel')
})
const touched = (snapshot) =>
  snapshot.host.objects + snapshot.splice.objects + snapshot.push.objects + snapshot.mcp.objects
const pushBaseline = state.persistDir ? objects('SealPushHost') : null

// ---- 1. oracle ----
// Four ids an outsider might probe: a live host, a host that was online earlier, an enrolled host
// that never came online, and an id the relay has never heard of.
setSourceIp(freshSourceIp())
const live = await hostOnline(origin)
const paired = await installResumeCredential(live.control)
const wentOffline = await hostOnline(origin)
wentOffline.control.ws.terminate()
await sleep(300)
const hostIds = {
  live: live.keys.hostId,
  offline: wentOffline.keys.hostId,
  neverOnline: enrolledHostKeys().hostId,
  notEnrolled: randomHostId()
}
const resolve = (relayHostId, resumeToken) =>
  postJson(origin, '/v1/resolve', { v: 1, relayHostId, resumeToken })
const uniform = (answers) =>
  new Set(Object.values(answers).map((a) => JSON.stringify(a))).size === 1

{
  const answers = {}
  for (const [kind, hostId] of Object.entries(hostIds)) {
    const response = await resolve(hostId, 'not-a-credential')
    answers[kind] = { http: response.status, body: response.text }
  }
  const pairedPhone = await resolve(live.keys.hostId, paired.resumeToken)
  report(
    '/v1/resolve answers without checking resumeToken',
    uniform(answers) && answers.live.http === 401 && pairedPhone.status === 200
      ? 'blocked'
      : 'VULNERABLE',
    { wrongToken: answers, pairedPhone: pairedPhone.status }
  )
}
{
  const answers = {}
  for (const [kind, hostId] of Object.entries(hostIds)) {
    const attempt = await phoneAttempt(origin, hostId)
    answers[kind] = { upgrade: attempt.upgrade, hello: attempt.hello?.code, close: attempt.close }
  }
  // The original F8 oracle was liveness: a live host answered differently from an offline one.
  // The hardening closes that: live and offline-assigned are now indistinguishable.
  const liveness = { live: answers.live, offline: answers.offline }
  report(
    '/v1/connect reveals whether a host is currently online (liveness oracle)',
    uniform(liveness) ? 'blocked' : 'VULNERABLE',
    liveness
  )
  // Residual: an id that has ever been assigned a cell (4401) still differs from one that never was
  // or is not enrolled (4409). It is not a liveness oracle (live == offline) and not an enrolment
  // oracle (never-assigned == not-enrolled); it only confirms a known, public id once came online.
  report(
    '/v1/connect close code: ever-assigned vs never-assigned/non-enrolled',
    uniform(answers) ? 'blocked' : 'info',
    {
      reason:
        'architectural: a non-enrolled or never-assigned id touches no Durable Object and gets 4409, an assigned host gets 4401; it leaks only "this public host id was assigned at some point", not liveness or enrolment',
      ...answers
    }
  )
}
{
  // Routes that refuse an id off the allowlist before addressing any object.
  const answers = {}
  for (const [kind, hostId] of Object.entries(hostIds)) {
    const mcp = await fetch(`${origin}/mcp/${hostId}`, { headers: sourceHeaders() })
    const data = openSocket(`${wsOrigin(origin)}/v1/host/data/${hostId}.0.${randomHostId()}`)
    await data.open()
    data.ws.terminate()
    answers[kind] = { mcp: mcp.status, dataUpgrade: data.upgradeStatus ?? 101 }
  }
  report(
    '/mcp and /v1/host/data answer an id off the allowlist differently (404)',
    uniform(answers) ? 'blocked' : 'info',
    {
      reason:
        'specified behaviour: these routes answer 404 for a host that is not enrolled; it confirms enrolment of an already known 96-bit host id',
      ...answers
    }
  )
}

// ---- 2. unauthenticated storage ----
if (!state.persistDir) {
  report('unauthenticated storage checks', 'skipped', {
    reason: 'the relay state has no persistDir to inspect; start lib/local-relay.mjs'
  })
} else {
  // One source address, so the per-source limits show.
  setSourceIp(freshSourceIp())
  await sleep(1500)
  const before = stored()
  for (let i = 0; i < N; i++) {
    await phoneAttempt(origin, randomHostId())
  }
  await sleep(1500)
  const afterConnect = stored()
  report(
    `/v1/connect/<random id> x${N}: host objects with tables`,
    touched(afterConnect) === touched(before) ? 'blocked' : 'VULNERABLE',
    { objectsTouched: touched(afterConnect) - touched(before) }
  )

  let resolveLimited = 0
  for (let i = 0; i < N; i++) {
    if ((await resolve(randomHostId(), 'x')).status === 429) {
      resolveLimited++
    }
  }
  await sleep(1500)
  const afterResolve = stored()
  report(
    `/v1/resolve <random id> x${N}: host objects with tables`,
    touched(afterResolve) === touched(afterConnect) ? 'blocked' : 'VULNERABLE',
    { objectsTouched: touched(afterResolve) - touched(afterConnect), rateLimited: resolveLimited }
  )

  // An enrolled host nobody assigned: asking about it may wake its object but must not write.
  setSourceIp(freshSourceIp())
  await resolve(hostIds.neverOnline, 'x')
  await sleep(1500)
  const afterDormant = stored()
  report(
    '/v1/resolve for an enrolled host that never came online: host objects with tables',
    afterDormant.host.withTables === afterResolve.host.withTables ? 'blocked' : 'VULNERABLE',
    { created: afterDormant.host.withTables - afterResolve.host.withTables }
  )

  setSourceIp(freshSourceIp())
  const statuses = {}
  for (let i = 0; i < N; i++) {
    const response = await hostChallenge(origin, newHostKeys())
    statuses[response.status] = (statuses[response.status] ?? 0) + 1
  }
  // The all-zero key is a low-order point: every "shared secret" with it is known to anyone.
  setSourceIp(freshSourceIp())
  const lowOrder = await hostChallenge(origin, {
    publicKeyB64: Buffer.alloc(32).toString('base64')
  })
  await sleep(1500)
  const afterChallenge = stored()
  const onlyRefusals = Object.keys(statuses).every((status) => ['403', '429'].includes(status))
  report(
    `/v1/host/challenge <random key> x${N}: push objects with tables`,
    onlyRefusals && lowOrder.status === 400 && touched(afterChallenge) === touched(afterDormant)
      ? 'blocked'
      : 'VULNERABLE',
    {
      answers: statuses,
      lowOrderKey: lowOrder.status,
      objectsTouched: touched(afterChallenge) - touched(afterDormant)
    }
  )

  // A host's public key is not secret (the phone holds it), so anyone can ask for its challenges.
  setSourceIp(freshSourceIp())
  for (let i = 0; i < MAX_PENDING_CHALLENGES + 4; i++) {
    await hostChallenge(origin, live.keys)
  }
  await sleep(1500)
  const flooded = objects('SealPushHost')
  await sleep(CHALLENGE_TTL_MS + 2500)
  const expired = objects('SealPushHost')
  report(
    `/v1/host/challenge x${MAX_PENDING_CHALLENGES + 4} on a known host key: rows left behind`,
    flooded.challengeRows > 0 &&
      flooded.challengeRows <= MAX_PENDING_CHALLENGES &&
      expired.challengeRows === 0 &&
      expired.withTables <= pushBaseline.withTables
      ? 'blocked'
      : 'VULNERABLE',
    {
      pendingAfterFlood: flooded.challengeRows,
      pendingAfterTtl: expired.challengeRows,
      pushObjectsWithTables: { before: pushBaseline.withTables, afterTtl: expired.withTables }
    }
  )
}

// ---- 3. per-source limits inside one IPv6 /64 ----
// One subscriber holds a whole /64 (2^64 addresses): once its budget is spent, another address in
// it must be refused too, while a different /64 is still served.
async function limitHoldsInsideSlash64(name, request) {
  let outcome
  for (let attempt = 0; attempt < 2; attempt++) {
    const group = () => randomBytes(2).toString('hex')
    const prefix = `2001:db8:${group()}:${group()}`
    const from = async (ip) => {
      setSourceIp(ip)
      return (await request()).status
    }
    let spent = 0
    // The local limiter counts per wall-clock minute, so a burst over a boundary gets two budgets.
    while (spent < 70 && (await from(`${prefix}::1`)) !== 429) {
      spent++
    }
    let admitted = 0
    for (let i = 0; i < N; i++) {
      if ((await from(`${prefix}::${(i + 2).toString(16)}`)) !== 429) {
        admitted++
      }
    }
    const stillSpent = (await from(`${prefix}::1`)) === 429
    const otherSlash64 = await from(`2001:db8:${group()}:${group()}::1`)
    outcome = { requestsBeforeLimit: spent, admittedAfterLimit: admitted, otherSlash64 }
    // Not still spent: the minute rolled over mid-check and the rotation proved nothing.
    if (stillSpent) {
      break
    }
  }
  report(
    name,
    outcome.requestsBeforeLimit < 70 &&
      outcome.admittedAfterLimit === 0 &&
      outcome.otherSlash64 !== 429
      ? 'blocked'
      : 'VULNERABLE',
    outcome
  )
}
await limitHoldsInsideSlash64(
  `/v1/resolve x${N} rotating inside one IPv6 /64 after the limit tripped`,
  () => resolve(randomHostId(), 'x')
)
await limitHoldsInsideSlash64(
  `/v1/host/challenge x${N} rotating inside one IPv6 /64 after the limit tripped`,
  () => hostChallenge(origin, newHostKeys())
)

live.control.ws.terminate()
finish()
