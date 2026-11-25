// Audit 1, A1-01 (with SR-02 and F2): requests that carry no host credential must leave nothing in
// Durable Object storage, and what an enrolled host leaves behind must not outlive its use.
// Real Worker in local workerd with object storage kept in a temp directory, loopback only.
import { randomBytes, randomUUID } from 'node:crypto'
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterAll, describe, expect, it } from 'vitest'
import { PUSH_LIMITS } from '../../../../packages/push-contract/src/push-limits'
import { deriveRelayHostId } from '../../../../../src/main/runtime/mobile-cloud-relay/director/relay-http-client'
import { sleep } from '../../seal-relay-harness'
import {
  enrolHost,
  newHostKeypair,
  phoneConnect,
  postJson,
  startRelayUnderTest,
  type RelayUnderTest
} from '../relay-attack-surface'

const N = 3

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
}

let workDir = ''
const stateDir = (): string => join(workDir, 'state')
let relay: RelayUnderTest | null = null

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
        rows
      })
    } finally {
      db.close()
    }
  }
  return reports
}

const randomHostId = (): string => randomBytes(12).toString('base64url')

describe('durable object storage', () => {
  afterAll(async () => {
    await relay?.dispose().catch(() => {})
    if (workDir) {
      rmSync(workDir, { recursive: true, force: true })
    }
  })

  it('is not created by anonymous requests, and is freed once an enrolled host has no use for it', async () => {
    workDir = mkdtempSync(join(tmpdir(), 'seal-relay-storage-'))
    const [live, idle] = [newHostKeypair(), newHostKeypair()]
    const idleId = deriveRelayHostId(idle.publicKey)
    relay = await startRelayUnderTest({ enrolled: [live, idle], persist: stateDir() })
    const { origin } = relay

    // A stranger's key, a made-up id, and an enrolled host that never went live.
    const strangerIds = Array.from({ length: N }, randomHostId)
    const statuses: number[] = []
    for (const id of [...strangerIds, idleId]) {
      statuses.push(
        (await postJson(`${origin}/v1/resolve`, { v: 1, relayHostId: id, resumeToken: 'x' }))
          .status,
        (
          await postJson(`${origin}/v1/host/session`, {
            v: 1,
            challengeId: `${id}.${randomUUID()}`,
            proofB64: randomBytes(32).toString('base64')
          })
        ).status,
        (await phoneConnect(origin, id, 'A'.repeat(43))).closeCode ?? 0
      )
    }
    for (let i = 0; i < N; i++) {
      await postJson(`${origin}/v1/host/challenge`, {
        v: 1,
        hostPublicKeyB64: randomBytes(32).toString('base64')
      })
    }
    // The enrolled host signs in (one challenge, consumed) and goes live: it alone keeps tables.
    const host = await enrolHost(origin, live)
    await host.stop()
    // An unanswered challenge of an enrolled key: purged once it expires, then the object is freed.
    await postJson(`${origin}/v1/host/challenge`, { v: 1, hostPublicKeyB64: idle.publicKeyB64 })
    await sleep(PUSH_LIMITS.challengeTtlMs + 4000)
    await relay.dispose()
    relay = null

    const objects = inspect('after')
    const withTables = objects
      .filter((object) => object.appTables.length > 0)
      .map((object) => `${object.cls}:${object.name}`)
    expect(statuses).toEqual([
      ...Array.from({ length: N }, () => [401, 403, 4409]).flat(),
      ...[401, 401, 4409]
    ])
    expect(withTables).toEqual([`SealHostRelay:${host.relayHostId}`])
  }, 120_000)
})
