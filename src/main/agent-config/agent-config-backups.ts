import type { AgentConfigBackup } from '../../shared/agent-config/agent-config-types'
import { isPlainObject } from '../../shared/agent-config/agent-config-values'
import { joinMachinePath, machinePathDirname } from '../../shared/machines/machine-paths'
import { quotePosixShell } from '../../shared/shell/launch/shell-argument-quoting'
import type { MachineConnection } from '../machines/connection/machine-connection'

const INDEX_FILE = 'index.jsonl'
const MAX_INDEX_BYTES = 4 * 1024 * 1024
/** Older backups are dropped once there are this many. */
const MAX_BACKUPS = 400
const EXEC_TIMEOUT_MS = 60_000

function powerShellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

export function backupRoot(home: string): string {
  return joinMachinePath(joinMachinePath(home, '.seal'), 'config-backups')
}

/** `2026-11-14T05-59-04-123Z-ab12`: sorts by time and never collides within a millisecond. */
export function backupStamp(now = new Date()): string {
  const suffix = Math.random().toString(36).slice(2, 6).padEnd(4, '0')
  return `${now.toISOString().replaceAll(':', '-').replace('.', '-')}-${suffix}`
}

/** The original's absolute path, mirrored under the stamp folder so a person can find it. */
export function backupPathFor(home: string, stamp: string, original: string): string {
  const relative = original
    .replace(/^([A-Za-z]):[\\/]/, '$1/')
    .replace(/^[\\/]+/, '')
    .split(/[\\/]/)
    .filter((part) => part !== '' && part !== '.' && part !== '..')
  return relative.reduce(joinMachinePath, joinMachinePath(backupRoot(home), stamp))
}

async function readIndex(
  connection: MachineConnection,
  home: string
): Promise<AgentConfigBackup[]> {
  const read = await connection.files
    .readFile(joinMachinePath(backupRoot(home), INDEX_FILE), MAX_INDEX_BYTES)
    .catch(() => null)
  if (!read) {
    return []
  }
  return read.data
    .toString('utf8')
    .split('\n')
    .flatMap((line): AgentConfigBackup[] => {
      try {
        const entry: unknown = JSON.parse(line)
        return isPlainObject(entry) &&
          typeof entry.backupPath === 'string' &&
          typeof entry.originalPath === 'string'
          ? [
              {
                backupPath: entry.backupPath,
                originalPath: entry.originalPath,
                takenAt: Number(entry.takenAt) || 0,
                bytes: Number(entry.bytes) || 0,
                isDirectory: entry.isDirectory === true
              }
            ]
          : []
      } catch {
        return []
      }
    })
}

async function ensureRoot(connection: MachineConnection, home: string): Promise<void> {
  const root = backupRoot(home)
  await connection.files.createDir(root)
  if ((await connection.dialect()) === 'posix') {
    // Backups can hold tokens copied out of config files; only this account may read them.
    await connection
      .exec(`chmod 700 ${quotePosixShell(root)}`, { timeoutMs: EXEC_TIMEOUT_MS })
      .catch(() => {})
  }
}

async function record(
  connection: MachineConnection,
  home: string,
  entry: AgentConfigBackup
): Promise<void> {
  const existing = await readIndex(connection, home)
  const kept = [...existing, entry].slice(-MAX_BACKUPS)
  const dropped = existing.slice(0, Math.max(0, existing.length + 1 - MAX_BACKUPS))
  await connection.files.writeFile(
    joinMachinePath(backupRoot(home), INDEX_FILE),
    Buffer.from(`${kept.map((item) => JSON.stringify(item)).join('\n')}\n`)
  )
  const keptPaths = new Set(kept.map((item) => item.backupPath))
  for (const old of dropped) {
    if (!keptPaths.has(old.backupPath)) {
      await connection.files.remove(old.backupPath).catch(() => {})
    }
  }
}

/** Copies a file's current bytes aside before it is changed; returns where the copy is. */
export async function backupFile(
  connection: MachineConnection,
  home: string,
  original: string,
  data: Buffer,
  stamp: string
): Promise<string> {
  await ensureRoot(connection, home)
  const backupPath = backupPathFor(home, stamp, original)
  await connection.files.createDir(machinePathDirname(backupPath) ?? backupRoot(home))
  await connection.files.writeFile(backupPath, data)
  await record(connection, home, {
    backupPath,
    originalPath: original,
    takenAt: Date.now(),
    bytes: data.length,
    isDirectory: false
  })
  return backupPath
}

async function moveTree(connection: MachineConnection, from: string, to: string): Promise<void> {
  try {
    await connection.files.rename(from, to)
    return
  } catch {
    // Another filesystem (a project on its own mount): copy, then delete.
  }
  const script =
    (await connection.dialect()) === 'powershell'
      ? `$ErrorActionPreference = 'Stop'; Copy-Item -LiteralPath ${powerShellLiteral(from)} -Destination ${powerShellLiteral(to)} -Recurse -Force; Remove-Item -LiteralPath ${powerShellLiteral(from)} -Recurse -Force`
      : `cp -Rp -- ${quotePosixShell(from)} ${quotePosixShell(to)} && rm -rf -- ${quotePosixShell(from)}`
  const result = await connection.exec(script, { timeoutMs: EXEC_TIMEOUT_MS })
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || `Could not move ${from} to the backups folder`)
  }
}

/** Deleting is moving: the file or folder goes to the backups folder, whole. */
export async function moveToBackups(
  connection: MachineConnection,
  home: string,
  original: string,
  stamp: string
): Promise<string> {
  await ensureRoot(connection, home)
  const stat = await connection.files.stat(original)
  const backupPath = backupPathFor(home, stamp, original)
  await connection.files.createDir(machinePathDirname(backupPath) ?? backupRoot(home))
  await moveTree(connection, original, backupPath)
  await record(connection, home, {
    backupPath,
    originalPath: original,
    takenAt: Date.now(),
    bytes: stat.isDirectoryLike ? 0 : stat.size,
    isDirectory: stat.isDirectoryLike
  })
  return backupPath
}

/** Newest first. */
export async function listBackups(
  connection: MachineConnection,
  home: string
): Promise<AgentConfigBackup[]> {
  return (await readIndex(connection, home)).toReversed()
}

export async function findBackup(
  connection: MachineConnection,
  home: string,
  backupPath: string
): Promise<AgentConfigBackup> {
  const entry = (await readIndex(connection, home)).find((item) => item.backupPath === backupPath)
  if (!entry) {
    throw new Error('That backup is not in the list any more')
  }
  return entry
}

export { moveTree as moveMachineTree }
