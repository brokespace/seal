// Audit 1, A1-01: /v1/resolve, /v1/host/challenge and /v1/host/session need no credential, and each
// leaves a Durable Object with SQLite tables for a caller-chosen id that nothing removes.
// Real Worker in local workerd with object storage kept in a temp directory, loopback only.
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import nacl from 'tweetnacl'
import WebSocket from 'ws'
import { unstable_startWorker } from 'wrangler'
import { afterAll, expect, it } from 'vitest'
import {
  createSealRelayContextReader,
  sealRelayEndpointConfig
} from '../../../../../src/main/runtime/mobile-cloud-relay/authentication/seal-relay-host-auth'
import {
  deriveRelayHostId,
  exchangeRelayAuthorization,
  requestRelayAssignment
} from '../../../../../src/main/runtime/mobile-cloud-relay/director/relay-http-client'
import { RelayAssignRateGate } from '../../../../../src/main/runtime/mobile-cloud-relay/director/relay-assign-rate-gate'
import { generateTestSecrets, sleep, startFakeProviders } from '../../seal-relay-harness'
import { describePoc } from './security-poc-opt-in'

const N = 3
const SWEEP_INTERVAL_MS = 2000
// A challenge lives 10 s and is purged 30 s after that, when the same key asks again.
const CHALLENGE_CLEANUP_DUE_MS = 42_000

type SqliteModule = { DatabaseSync: typeof DatabaseSync }
// Vite cannot resolve node:sqlite as an import.
const sqlite = (
  process as unknown as { getBuiltinModule: (name: string) => SqliteModule }
).getBuiltinModule('node:sqlite')

type ObjectReport = {
  cls: string
  name: string | null
  appTables: string[]
  rows: Record<string, number>
  kvKeys: string[]
}

let workDir = ''
const stateDir = (): string => join(workDir, 'state')
let disposeWorker: () => Promise<void> = async () => {}
let providers: Awaited<ReturnType<typeof startFakeProviders>> | null = null

async function freePort(): Promise<number> {
  const server = createNetServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  if (!address || typeof address === 'string') {
    throw new Error('no free port')
  }
  return address.port
}

// The repository harness with one change: object storage is persisted so it can be read.
async function startRelay(vars: Record<string, string>): Promise<string> {
  const port = await freePort()
  const worker = await unstable_startWorker({
    config: fileURLToPath(new URL('../../../wrangler.toml', import.meta.url)),
    bindings: Object.fromEntries(
      Object.entries(vars).map(([name, value]) => [name, { type: 'plain_text' as const, value }])
    ),
    dev: {
      server: { hostname: '127.0.0.1', port },
      origin: { hostname: `127.0.0.1:${port}`, secure: false },
      inspector: false,
      persist: stateDir(),
      logLevel: 'warn'
    }
  } as Parameters<typeof unstable_startWorker>[0])
  await worker.ready
  disposeWorker = () => worker.dispose()
  return (await worker.url).origin
}

async function stopRelay(): Promise<void> {
  const dispose = disposeWorker
  disposeWorker = async () => {}
  await dispose()
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) {
    return []
  }
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]
  )
}

function asText(value: unknown): unknown {
  return value instanceof Uint8Array ? Buffer.from(value).toString('utf8') : value
}

// Reads every object database of the Worker's own classes from a copy taken after it stopped.
function inspect(copyName: string): ObjectReport[] {
  const copyDir = join(workDir, copyName)
  cpSync(stateDir(), copyDir, { recursive: true })
  const reports: ObjectReport[] = []
  for (const file of walk(copyDir)) {
    const cls = basename(dirname(file))
    if (!file.endsWith('.sqlite') || !cls.startsWith('seal-relay-')) {
      continue
    }
    const db = new sqlite.DatabaseSync(file)
    try {
      const tables = (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
          name: string
        }[]
      ).map((row) => row.name)
      const rows: Record<string, number> = {}
      for (const table of tables) {
        rows[table] = Number(
          (db.prepare(`SELECT count(*) AS n FROM "${table}"`).get() as { n: number }).n
        )
      }
      const nameRow = tables.includes('__miniflare_do_name')
        ? (db.prepare('SELECT * FROM __miniflare_do_name').all()[0] as
            | Record<string, unknown>
            | undefined)
        : undefined
      const name = nameRow
        ? Object.values(nameRow)
            .map(asText)
            .find((value) => typeof value === 'string')
        : null
      reports.push({
        cls: cls.replace(/^seal-relay-/, ''),
        name: typeof name === 'string' ? name : null,
        // Everything except local workerd's own bookkeeping tables.
        appTables: tables.filter((t) => !t.startsWith('__miniflare') && !t.startsWith('_cf_')),
        rows,
        kvKeys: tables.includes('_cf_KV')
          ? (db.prepare('SELECT key FROM _cf_KV').all() as { key: unknown }[]).map((row) =>
              String(asText(row.key))
            )
          : []
      })
    } finally {
      db.close()
    }
  }
  return reports
}

const randomHostId = (): string => randomBytes(12).toString('base64url')

const fingerprintOf = (publicKey: Uint8Array): string =>
  createHash('sha256').update(publicKey).digest('base64url').slice(0, 16)

describePoc('audit 1 A1-01: anonymous Durable Object storage', () => {
  afterAll(async () => {
    await stopRelay().catch(() => {})
    await providers?.close().catch(() => {})
    if (workDir) {
      rmSync(workDir, { recursive: true, force: true })
    }
  })

  it('anonymous resolve, challenge and session requests leave tables that outlive a restart', async () => {
    workDir = mkdtempSync(join(tmpdir(), 'seal-audit-1-storage-'))
    providers = await startFakeProviders()
    const generated = await generateTestSecrets()
    const vars = {
      ...generated.secrets,
      PUSH_PROVIDER_ORIGIN_OVERRIDE: providers.origin,
      SWEEP_INTERVAL_MS: String(SWEEP_INTERVAL_MS)
    }
    const origin = await startRelay(vars)
    const post = (path: string, body: unknown): Promise<Response> =>
      fetch(`${origin}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      })

    // Control: the shared edge's own anonymous path for a host nobody registered.
    const unknownPhoneHost = randomHostId()
    const phoneHello = await new Promise<string | null>((resolve) => {
      const socket = new WebSocket(
        `${origin.replace(/^http/, 'ws')}/v1/connect/${unknownPhoneHost}`,
        { perMessageDeflate: false }
      )
      socket.on('open', () =>
        socket.send(
          JSON.stringify({ type: 'relay-auth', v: 1, mode: 'connect', credential: 'A'.repeat(43) })
        )
      )
      socket.on('message', (raw: Buffer) => resolve(raw.toString()))
      socket.on('close', () => resolve(null))
      socket.on('error', () => resolve(null))
    })

    const resolveIds = Array.from({ length: N }, randomHostId)
    const resolveStatuses: number[] = []
    for (const relayHostId of resolveIds) {
      resolveStatuses.push(
        (await post('/v1/resolve', { v: 1, relayHostId, resumeToken: 'x' })).status
      )
    }

    // Any 32 bytes are accepted as a public key.
    const challengeFingerprints: string[] = []
    const challengeStatuses: number[] = []
    for (let i = 0; i < N; i++) {
      const key = randomBytes(32)
      challengeFingerprints.push(fingerprintOf(key))
      challengeStatuses.push(
        (await post('/v1/host/challenge', { v: 1, hostPublicKeyB64: key.toString('base64') }))
          .status
      )
    }
    const challengesIssuedAt = Date.now()

    // Invented fingerprints: no key and no earlier challenge.
    const sessionFingerprints = Array.from({ length: N }, randomHostId)
    const sessionStatuses: number[] = []
    for (const fingerprint of sessionFingerprints) {
      sessionStatuses.push(
        (
          await post('/v1/host/session', {
            v: 1,
            challengeId: `${fingerprint}.${randomUUID()}`,
            proofB64: randomBytes(32).toString('base64')
          })
        ).status
      )
    }

    // Control: a host that proves its key and assigns keeps its object.
    const box = nacl.box.keyPair()
    const registered = { ...box, publicKeyB64: Buffer.from(box.publicKey).toString('base64') }
    const registeredId = deriveRelayHostId(registered.publicKey)
    const endpoints = sealRelayEndpointConfig(origin)
    const context = await createSealRelayContextReader({
      relayOrigin: origin,
      keypair: registered
    })()
    const { relayToken } = await exchangeRelayAuthorization({
      endpoint: endpoints.relayTokenEndpoint,
      accessToken: context!.accessToken,
      keypair: registered
    })
    await requestRelayAssignment({
      directorUrl: endpoints.relayDirectorUrl,
      relayToken,
      relayHostId: registeredId,
      assignRateGate: new RelayAssignRateGate()
    })

    // Wait until challenge cleanup is due; that is also about twenty sweep intervals.
    await sleep(Math.max(0, challengesIssuedAt + CHALLENGE_CLEANUP_DUE_MS - Date.now()))
    await stopRelay()
    const first = inspect('first')

    await startRelay(vars)
    await sleep(SWEEP_INTERVAL_MS * 2 + 1000)
    await stopRelay()
    const afterRestart = inspect('after-restart')

    const find = (reports: ObjectReport[], cls: string, name: string): ObjectReport | undefined =>
      reports.find((report) => report.cls === cls && report.name === name)

    expect(phoneHello).toContain('4409')
    expect(find(first, 'SealHostRelay', unknownPhoneHost)?.appTables ?? []).toEqual([])
    expect(find(first, 'SealHostRelay', registeredId)?.rows.edge_assignment).toBe(1)
    expect(resolveStatuses).toEqual([404, 404, 404])
    expect(challengeStatuses).toEqual([200, 200, 200])
    expect(sessionStatuses).toEqual([401, 401, 401])

    for (const reports of [first, afterRestart]) {
      for (const id of resolveIds) {
        const object = find(reports, 'SealHostRelay', id)
        expect(object?.appTables).toEqual(
          expect.arrayContaining(['edge_assignment', 'edge_meta', 'edge_move', 'relay_devices'])
        )
        expect(object?.rows.edge_assignment).toBe(0)
        // No sweep is armed, so the wipe of never-assigned objects cannot reach it.
        expect(object?.kvKeys).not.toContain('sweepAt')
      }
      for (const fingerprint of challengeFingerprints) {
        const object = find(reports, 'SealPushHost', fingerprint)
        expect(object?.appTables).toEqual(['challenges', 'devices', 'send_quota'])
        expect(object?.rows.challenges).toBe(1)
      }
      for (const fingerprint of sessionFingerprints) {
        const object = find(reports, 'SealPushHost', fingerprint)
        expect(object?.appTables).toEqual(['challenges', 'devices', 'send_quota'])
      }
    }
  }, 240_000)
})
