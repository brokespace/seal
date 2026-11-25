// Runs the audit-3 relay attack scripts against the real Worker in local workerd. Each script
// probes the hardened relay from the outside and prints one JSON verdict per check; a check that
// still sees exploitable behaviour prints `"verdict":"VULNERABLE"` and the script exits non-zero.
// This suite fails if either happens, so a regression in the relay's defences breaks the build.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  generateTestSecrets,
  newHostKeypair,
  startFakeProviders,
  startSealRelay
} from '../seal-relay-harness'
// The scripts and the suite share one reader/writer for the state a running relay leaves on disk.
import { logProviderRequest, writeRelayState } from '../../../../security/audit-3/lib/relay-state.mjs'

const SCRIPT_DIR = new URL('../../../../security/audit-3/relay/', import.meta.url)
const ENROLLED_POOL = 64

type ScriptResult = { code: number | null; stdout: string; stderr: string }

function runNode(script: string, env: NodeJS.ProcessEnv): Promise<ScriptResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL(script, SCRIPT_DIR))], {
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

const teardowns: Array<() => Promise<void>> = []
afterEach(async () => {
  while (teardowns.length > 0) {
    await teardowns.pop()?.()
  }
})

// Starts a fresh relay (its own enrolled pool, fake providers and state dir) and runs one script
// against it, so the scripts never share a key pool or step on each other's rate-limit windows.
async function runScript(script: string, options: { spliceIdleTimeoutMs?: number } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'seal-audit3-'))
  const persistDir = join(dir, 'relay-state')
  const pushLog = join(dir, 'provider-requests.jsonl')
  writeFileSync(pushLog, '')

  const providers = await startFakeProviders()
  providers.respond((request) => {
    logProviderRequest(pushLog, { path: request.path, body: request.body })
    return request.path.includes('oauth2')
      ? { status: 200, body: JSON.stringify({ access_token: 'fake', expires_in: 3600 }) }
      : { status: 200 }
  })

  const { secrets } = await generateTestSecrets()
  const enrolled = Array.from({ length: ENROLLED_POOL }, () => newHostKeypair())
  const providerOverrideDecoy = '/override-honoured'
  const relay = await startSealRelay(
    {
      ...secrets,
      // Removed from production; 08 proves the override is ignored by pointing it at a decoy path.
      PUSH_PROVIDER_ORIGIN_OVERRIDE: `${providers.origin}${providerOverrideDecoy}`,
      ...(options.spliceIdleTimeoutMs
        ? { SPLICE_IDLE_TIMEOUT_MS: String(options.spliceIdleTimeoutMs) }
        : {})
    },
    { enrolled, providerOrigin: providers.origin, persist: persistDir }
  )
  teardowns.push(async () => {
    await relay.dispose()
    await providers.close()
    rmSync(dir, { recursive: true, force: true })
  })

  writeRelayState(dir, {
    relay: {
      origin: relay.origin,
      persistDir,
      pushLog,
      providerOverrideDecoy,
      ...(options.spliceIdleTimeoutMs ? { spliceIdleTimeoutMs: options.spliceIdleTimeoutMs } : {})
    },
    enrolledHosts: enrolled,
    operatorSecrets: secrets
  })

  const result = await runNode(script, {
    ...process.env,
    SEAL_AUDIT_STATE_DIR: dir,
    SEAL_AUDIT_RELAY_ORIGIN: relay.origin
  })
  const vulnerable = result.stdout
    .split('\n')
    .filter((line) => line.includes('"verdict":"VULNERABLE"'))
  expect(
    vulnerable,
    `${script} reported exploitable behaviour:\n${vulnerable.join('\n')}\n\nstderr:\n${result.stderr}`
  ).toEqual([])
  expect(
    result.code,
    `${script} exited ${result.code}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  ).toBe(0)
}

describe('audit-3 relay attacks against the hardened Worker', () => {
  it('01: unauthenticated upgrades and routes are refused', () =>
    runScript('01-unauth-upgrades-and-routes.mjs'))
  it('02: no host oracle and no pre-auth storage', () =>
    runScript('02-host-oracle-and-preauth-storage.mjs'), 90_000)
  it('03: credential brute force is rate-limited and rejected', () =>
    runScript('03-credential-bruteforce.mjs'))
  it('04: token, proof and connection replays are rejected', () => runScript('04-replay.mjs'), 90_000)
  it('05: cross-tenant access is denied', () => runScript('05-cross-tenant.mjs'))
  it('06: malformed and oversized inputs are rejected', () =>
    runScript('06-malformed-and-oversized.mjs'), 90_000)
  it('07: slowloris and flooding cannot lock out a real phone', () =>
    runScript('07-slowloris-and-flood.mjs', { spliceIdleTimeoutMs: 3000 }), 90_000)
  it('08: push endpoints resist abuse', () => runScript('08-push-abuse.mjs'))
})
