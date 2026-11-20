// The files a running local relay leaves for the attack scripts: where it listens, the pool of
// enrolled host keys, and (opt-in) the operator's secrets. Written by lib/local-relay.mjs and by
// the Worker's vitest suite; everything in them is generated throwaway material.
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'

export function stateDir() {
  return process.env.SEAL_AUDIT_STATE_DIR ?? '/tmp/seal-audit3'
}

function writePrivate(path, value) {
  writeFileSync(path, `${JSON.stringify(value)}\n`, { mode: 0o600 })
  // The mode above only applies to a file this call created.
  chmodSync(path, 0o600)
}

// `enrolledHosts` are X25519 key pairs ({ publicKey, secretKey } bytes) on the relay's allowlist.
export function writeRelayState(dir, { relay, enrolledHosts, operatorSecrets }) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'relay.json'), `${JSON.stringify(relay, null, 2)}\n`)
  writePrivate(
    join(dir, 'enrolled-hosts.json'),
    enrolledHosts.map((host) => ({
      publicKeyB64: Buffer.from(host.publicKey).toString('base64'),
      secretKeyB64: Buffer.from(host.secretKey).toString('base64')
    }))
  )
  writeFileSync(join(dir, 'enrolled-hosts.next'), '0\n')
  // A file left by an earlier relay would hold secrets this one does not use.
  rmSync(join(dir, 'operator-secrets.json'), { force: true })
  if (operatorSecrets) {
    writePrivate(join(dir, 'operator-secrets.json'), operatorSecrets)
  }
}

export function relayState(dir = stateDir()) {
  return JSON.parse(readFileSync(join(dir, 'relay.json'), 'utf8'))
}

// Null unless the relay was started for the "malicious relay operator" checks.
export function operatorSecrets(dir = stateDir()) {
  const path = join(dir, 'operator-secrets.json')
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
}

// Each enrolled key is handed out once per relay, so a script never meets a host that an earlier
// script already assigned, paired or filled with devices.
export function claimEnrolledHost(dir = stateDir()) {
  const pool = JSON.parse(readFileSync(join(dir, 'enrolled-hosts.json'), 'utf8'))
  const cursor = join(dir, 'enrolled-hosts.next')
  const next = Number(readFileSync(cursor, 'utf8'))
  if (!(next < pool.length)) {
    throw new Error(`all ${pool.length} enrolled hosts are used: restart the local relay`)
  }
  writeFileSync(cursor, `${next + 1}\n`)
  return pool[next]
}

// What the fake push provider saw. Path and payload only: never the provider bearer token.
export function logProviderRequest(pushLog, { path, body }) {
  appendFileSync(pushLog, `${JSON.stringify({ at: Date.now(), path, body })}\n`)
}

export function providerRequests(pushLog) {
  return readFileSync(pushLog, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}
