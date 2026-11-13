import type { MachineIdentity } from './machine-record'
import type { MachineFileEntry, MachineFileKind, MachineMetrics, MachineOs } from './machine-types'

export type MachineHostDirPage = { entries: MachineFileEntry[]; total: number }

export type MachineHostStat = MachineFileEntry & { path: string }

export type MachineHostChunk = { size: number; contentBase64: string }

export type MachineHostStreamEvent =
  | { type: 'starting'; subscriptionId: string }
  | { type: 'change'; dir: string }
  | { type: 'progress'; transferred: number; total: number | null }
  | { type: 'done'; transferred: number; total: number | null }
  | { type: 'cancelled' }
  | { type: 'error'; message: string }
  | { type: 'data'; dataBase64: string }
  | { type: 'exit'; exitCode: number | null }
  | { type: 'end' }

export type MachineExecResult = {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

type Fields = Record<string, unknown>

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

const FILE_KINDS: readonly MachineFileKind[] = ['file', 'directory', 'symlink', 'other']

function fileKind(value: unknown): MachineFileKind | null {
  return FILE_KINDS.find((kind) => kind === value) ?? null
}

export function parseMachineFileEntry(value: unknown): MachineFileEntry | null {
  if (!isFields(value)) {
    return null
  }
  const name = text(value.name)
  const kind = fileKind(value.kind)
  if (name === null || kind === null) {
    return null
  }
  return {
    name,
    kind,
    isDirectoryLike: value.isDirectoryLike === true,
    size: finite(value.size) ?? 0,
    mtimeMs: finite(value.mtimeMs) ?? 0
  }
}

export function parseMachineHostDirPage(value: unknown): MachineHostDirPage {
  if (!isFields(value) || !Array.isArray(value.entries)) {
    throw new Error('Runtime returned an invalid folder listing')
  }
  const entries = value.entries
    .map(parseMachineFileEntry)
    .filter((entry): entry is MachineFileEntry => entry !== null)
  return { entries, total: finite(value.total) ?? entries.length }
}

export function parseMachineHostStat(value: unknown): MachineHostStat {
  const entry = parseMachineFileEntry(value)
  const path = isFields(value) ? text(value.path) : null
  if (!entry || path === null) {
    throw new Error('Runtime returned an invalid file stat')
  }
  return { ...entry, path }
}

export function parseMachineHostChunk(value: unknown): MachineHostChunk {
  if (!isFields(value) || typeof value.contentBase64 !== 'string') {
    throw new Error('Runtime returned an invalid file chunk')
  }
  return { size: finite(value.size) ?? 0, contentBase64: value.contentBase64 }
}

export function parseMachineHostStreamEvent(value: unknown): MachineHostStreamEvent | null {
  if (!isFields(value)) {
    return null
  }
  switch (value.type) {
    case 'starting': {
      const subscriptionId = text(value.subscriptionId)
      return subscriptionId === null ? null : { type: 'starting', subscriptionId }
    }
    case 'change': {
      const dir = text(value.dir)
      return dir === null ? null : { type: 'change', dir }
    }
    case 'progress':
    case 'done':
      return {
        type: value.type,
        transferred: finite(value.transferred) ?? 0,
        total: finite(value.total)
      }
    case 'cancelled':
    case 'end':
      return { type: value.type }
    case 'error':
      return { type: 'error', message: text(value.message) ?? 'Runtime operation failed' }
    case 'data':
      return typeof value.dataBase64 === 'string'
        ? { type: 'data', dataBase64: value.dataBase64 }
        : null
    case 'exit':
      return { type: 'exit', exitCode: finite(value.exitCode) }
    default:
      return null
  }
}

const MACHINE_OSES: readonly MachineOs[] = ['linux', 'darwin', 'win32']

/** Accepts metrics from another Seal version: unknown fields drop, missing ones become null. */
export function parseMachineMetrics(value: unknown, collectedAt: number): MachineMetrics {
  if (!isFields(value)) {
    throw new Error('Runtime returned invalid machine stats')
  }
  const load = Array.isArray(value.loadAverage) ? value.loadAverage.map(finite) : []
  const [one, five, fifteen] = load
  return {
    hostname: text(value.hostname),
    os: MACHINE_OSES.find((os) => os === value.os) ?? null,
    osRelease: text(value.osRelease),
    arch: text(value.arch),
    cpuCount: finite(value.cpuCount),
    cpuModel: text(value.cpuModel),
    loadAverage:
      one != null && five != null && fifteen != null && load.length === 3
        ? [one, five, fifteen]
        : null,
    cpuUsagePercent: finite(value.cpuUsagePercent),
    memTotalBytes: finite(value.memTotalBytes),
    memAvailableBytes: finite(value.memAvailableBytes),
    diskTotalBytes: finite(value.diskTotalBytes),
    diskAvailableBytes: finite(value.diskAvailableBytes),
    diskMount: text(value.diskMount),
    uptimeSeconds: finite(value.uptimeSeconds),
    homeDir: text(value.homeDir),
    collectedAt
  }
}

export function parseMachineExecResult(value: unknown): MachineExecResult {
  if (!isFields(value)) {
    throw new Error('Runtime returned an invalid command result')
  }
  return {
    exitCode: finite(value.exitCode),
    stdout: typeof value.stdout === 'string' ? value.stdout : '',
    stderr: typeof value.stderr === 'string' ? value.stderr : '',
    timedOut: value.timedOut === true
  }
}

export function parseMachineIdentity(value: unknown): MachineIdentity {
  return isFields(value)
    ? { hostname: text(value.hostname), machineId: text(value.machineId) }
    : { hostname: null, machineId: null }
}
