import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getAppEnvironment } from '../../shared/app-environment'
import { writeSecureJsonFile } from '../../shared/secure-storage/secure-file'

/** A session's key opens these servers; tokens are looked up per request, never stored here. */
export type RelayBinding = { serverName: string; connectorId: string; signInId: string | null }

export type KeyRecord = {
  sessionId: string
  bindings: RelayBinding[]
  createdAt: number
  lastUsedAt: number
}

const KEY_MAX_IDLE_MS = 14 * 24 * 60 * 60 * 1000
const LAST_USED_SAVE_MS = 10 * 60 * 1000

/** What `<userData>/seal-connectors/relay.json` holds, plus the keys this process minted. */
export type RelayKeys = {
  dir: string
  port: number | null
  /** Keyed by the sha256 of the key. */
  keys: Map<string, KeyRecord>
  /** Plaintext keys minted by this process, so a relaunch of a session reuses its key. */
  minted: Map<string, string>
  dirtyLastUsed: boolean
  savedAt: number
}

let state: RelayKeys | null = null

function connectorsDir(): string {
  return join(getAppEnvironment().getPath('userData'), 'seal-connectors')
}

function relayFile(dir: string): string {
  return join(dir, 'relay.json')
}

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBinding(value: unknown): value is RelayBinding {
  return (
    isRecord(value) &&
    typeof value.serverName === 'string' &&
    typeof value.connectorId === 'string' &&
    (value.signInId === null || typeof value.signInId === 'string')
  )
}

function readRelayFile(dir: string): { port: number | null; keys: Map<string, KeyRecord> } {
  const keys = new Map<string, KeyRecord>()
  try {
    const parsed: unknown = JSON.parse(readFileSync(relayFile(dir), 'utf8'))
    if (!isRecord(parsed)) {
      return { port: null, keys }
    }
    for (const [hash, value] of Object.entries(isRecord(parsed.keys) ? parsed.keys : {})) {
      if (
        isRecord(value) &&
        typeof value.sessionId === 'string' &&
        Array.isArray(value.bindings) &&
        value.bindings.every(isBinding) &&
        typeof value.createdAt === 'number' &&
        typeof value.lastUsedAt === 'number'
      ) {
        keys.set(hash, {
          sessionId: value.sessionId,
          bindings: value.bindings,
          createdAt: value.createdAt,
          lastUsedAt: value.lastUsedAt
        })
      }
    }
    const port =
      typeof parsed.port === 'number' && Number.isInteger(parsed.port) ? parsed.port : null
    return { port, keys }
  } catch {
    return { port: null, keys }
  }
}

/** This host's relay state, read from disk the first time; `dir` only matters on that first read. */
export function relayKeys(dir?: string): RelayKeys {
  if (!state) {
    const resolved = dir ?? connectorsDir()
    const file = readRelayFile(resolved)
    state = {
      dir: resolved,
      port: file.port,
      keys: file.keys,
      minted: new Map(),
      dirtyLastUsed: false,
      savedAt: Date.now()
    }
    pruneRelayKeys(state)
  }
  return state
}

/** Forgets the loaded state, flushing deferred use times first. */
export function releaseRelayKeys(): void {
  if (state?.dirtyLastUsed) {
    saveRelayKeys(state)
  }
  state = null
}

export function saveRelayKeys(relay: RelayKeys): void {
  try {
    writeSecureJsonFile(relayFile(relay.dir), {
      port: relay.port,
      keys: Object.fromEntries(relay.keys)
    })
    relay.dirtyLastUsed = false
    relay.savedAt = Date.now()
  } catch (error) {
    console.warn(
      '[seal-connectors] Could not save the relay keys:',
      error instanceof Error ? error.name : 'Error'
    )
  }
}

/** Drops keys unused for two weeks; runs when keys are loaded or minted, so no timer is needed. */
function pruneRelayKeys(relay: RelayKeys): void {
  const cutoff = Date.now() - KEY_MAX_IDLE_MS
  let removed = false
  for (const [hash, record] of relay.keys) {
    if (record.lastUsedAt < cutoff) {
      relay.keys.delete(hash)
      removed = true
    }
  }
  if (removed) {
    for (const [identity, key] of relay.minted) {
      if (!relay.keys.has(hashKey(key))) {
        relay.minted.delete(identity)
      }
    }
    saveRelayKeys(relay)
  }
}

/** Mints (or reuses, within this process) the key a session's tools use to reach the relay. */
export function mintSessionKey(sessionId: string, bindings: RelayBinding[]): string {
  const relay = relayKeys()
  pruneRelayKeys(relay)
  const identity = JSON.stringify([sessionId, bindings])
  const reused = relay.minted.get(identity)
  if (reused && relay.keys.has(hashKey(reused))) {
    return reused
  }
  const key = randomBytes(32).toString('base64url')
  const now = Date.now()
  relay.keys.set(hashKey(key), { sessionId, bindings, createdAt: now, lastUsedAt: now })
  relay.minted.set(identity, key)
  saveRelayKeys(relay)
  return key
}

/** Points every key a session already holds at a new plan (a resume or account swap). */
export function rebindSessionKeys(sessionId: string, bindings: RelayBinding[]): void {
  const relay = relayKeys()
  let changed = false
  for (const [hash, record] of relay.keys) {
    if (record.sessionId === sessionId) {
      record.bindings = bindings
      changed = true
      for (const [identity, key] of relay.minted) {
        if (hashKey(key) === hash) {
          relay.minted.delete(identity)
        }
      }
    }
  }
  if (changed) {
    saveRelayKeys(relay)
  }
}

/** The record a presented key opens, compared in constant time; marks it used. */
export function openSessionKey(relay: RelayKeys, key: string): KeyRecord | null {
  const wanted = Buffer.from(hashKey(key))
  for (const [hash, record] of relay.keys) {
    const stored = Buffer.from(hash)
    if (stored.length === wanted.length && timingSafeEqual(stored, wanted)) {
      const now = Date.now()
      record.lastUsedAt = now
      relay.dirtyLastUsed = true
      if (now - relay.savedAt > LAST_USED_SAVE_MS) {
        saveRelayKeys(relay)
      }
      return record
    }
  }
  return null
}
