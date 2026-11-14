import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type {
  MachineDiskIndexReply,
  MachineDiskIndexRequest,
  MachineDiskIndexStatus
} from '../../../shared/machines/machine-disk-index-types'
import { joinMachinePath } from '../../../shared/machines/machine-paths'
import type { MachineId } from '../../../shared/machines/machine-types'
import { getForkedChildEntryPath } from '../../worker-threads/forked-child-entry-path'
import type { MachineConnection } from '../connection/machine-connection'
import {
  buildDiskIndexScript,
  DISK_INDEX_NO_DAEMON,
  DISK_INDEX_NO_NODE,
  DISK_INDEX_NO_PROGRAM,
  DISK_INDEX_REMOTE_DIR
} from './machine-disk-index-script'
import { listMachineDiskMounts, measureMachineDiskUsage } from './machine-disk-usage'
import { runMachineHostScript } from './machine-host-script'

const PROGRAM_ENTRY = 'disk-usage-index-entry.js'
const QUERY_TIMEOUT_MS = 90_000
/** How long a machine that cannot run the index is served live before it is asked again. */
const UNAVAILABLE_RETRY_MS = 5 * 60_000
const ENSURE_EVERY_MS = 6 * 60 * 60_000

type Program = { name: string; bytes: Buffer }
type Unavailable = { reason: NonNullable<MachineDiskIndexStatus['unavailableReason']>; at: number }

let program: Promise<Program> | null = null
const unavailable = new Map<MachineId, Unavailable>()

function loadProgram(): Promise<Program> {
  program ??= readFile(getForkedChildEntryPath(PROGRAM_ENTRY)).then((bytes) => {
    // A build that split the program across files cannot be copied to another machine as one.
    if (/require\(["']\.{1,2}\//.test(bytes.toString('utf8'))) {
      throw new Error('The disk index program is not self-contained in this build.')
    }
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12)
    return { name: `disk-usage-index-${hash}.cjs`, bytes }
  })
  program.catch(() => {
    program = null
  })
  return program
}

async function installProgram(connection: MachineConnection, build: Program): Promise<void> {
  const dir = joinMachinePath(await connection.files.homeDir(), DISK_INDEX_REMOTE_DIR)
  await connection.files.createDir(dir)
  await connection.files.writeFile(joinMachinePath(dir, build.name), build.bytes)
}

/** Sizes measured on demand with `df` and `du`, for a machine that cannot run the index. */
async function answerLive(
  connection: MachineConnection,
  request: MachineDiskIndexRequest,
  reason: Unavailable['reason'],
  signal?: AbortSignal
): Promise<MachineDiskIndexReply> {
  if (request.op === 'list') {
    const usage = await measureMachineDiskUsage(connection, request.path, signal)
    return {
      ok: true,
      listing: {
        path: usage.path,
        totalBytes: usage.totalBytes,
        entries: usage.entries.map((entry) => ({
          ...entry,
          files: null,
          mtimeMs: null,
          notIndexed: false,
          unreadable: false
        })),
        omittedCount: usage.omittedCount,
        omittedBytes: usage.omittedBytes,
        incomplete: usage.incomplete,
        scannedAt: null
      }
    }
  }
  if (request.op === 'largest') {
    return { ok: true, largest: { kind: request.kind, items: [], scannedAt: null } }
  }
  const mounts = await listMachineDiskMounts(connection)
  return {
    ok: true,
    status: {
      source: 'live',
      unavailableReason: reason,
      mounts: mounts.map((mount) => ({
        ...mount,
        fsType: null,
        indexed: false,
        skipReason: null,
        scannedAt: null,
        scanDurationMs: null,
        scanMode: null,
        indexedBytes: null,
        indexedFiles: null,
        indexedFolders: null,
        unreadableFolders: 0
      })),
      scan: null,
      nextScanAt: null,
      now: Date.now(),
      generation: 0,
      protectedFoldersSkipped: false
    }
  }
}

function parseReply(stdout: string): MachineDiskIndexReply | string {
  const line = stdout.trim().split(/\r?\n/).at(-1) ?? ''
  if (!line.startsWith('{')) {
    return line
  }
  try {
    const reply: MachineDiskIndexReply = JSON.parse(line)
    return reply
  } catch {
    return DISK_INDEX_NO_DAEMON
  }
}

/**
 * One question to a machine's disk-usage index. The index daemon is started on first use and the
 * program is copied over when the machine does not have this build yet; both go through the
 * machine's ordinary command and file channels, so every transport behaves the same.
 */
export async function queryMachineDiskIndex(
  connection: MachineConnection,
  request: MachineDiskIndexRequest,
  signal?: AbortSignal
): Promise<MachineDiskIndexReply> {
  const known = unavailable.get(connection.machineId)
  if (known && Date.now() - known.at < UNAVAILABLE_RETRY_MS) {
    return answerLive(connection, request, known.reason, signal)
  }
  const build = await loadProgram().catch(() => null)
  if (!build) {
    return answerLive(connection, request, 'failed', signal)
  }
  // This computer needs no Node of its own: the index runs on the runtime Seal itself runs on.
  const local =
    connection.transport === 'local' ? { node: process.execPath, ownerPid: process.pid } : null
  const script = buildDiskIndexScript({ programName: build.name, request, local })
  const run = async (): Promise<MachineDiskIndexReply | string> =>
    parseReply(
      (
        await runMachineHostScript(connection, script, {
          timeoutMs: QUERY_TIMEOUT_MS,
          ...(signal ? { signal } : {})
        })
      ).stdout
    )
  let reply = await run()
  if (reply === DISK_INDEX_NO_PROGRAM) {
    await installProgram(connection, build)
    reply = await run()
  }
  if (typeof reply !== 'string') {
    unavailable.delete(connection.machineId)
    return reply
  }
  const reason = reply === DISK_INDEX_NO_NODE ? 'no-node' : 'failed'
  unavailable.set(connection.machineId, { reason, at: Date.now() })
  return answerLive(connection, request, reason, signal)
}

const ensuredAt = new Map<MachineId, number>()

/**
 * Starts a machine's index daemon as soon as Seal is talking to the machine, so the index is
 * already there when someone opens the disk panel. Repeating it keeps a remote daemon from
 * deciding nobody uses it any more.
 */
export function ensureMachineDiskIndex(connection: MachineConnection): void {
  const machineId = connection.machineId
  if (Date.now() - (ensuredAt.get(machineId) ?? 0) < ENSURE_EVERY_MS) {
    return
  }
  ensuredAt.set(machineId, Date.now())
  void queryMachineDiskIndex(connection, { op: 'status' }).catch(() => ensuredAt.delete(machineId))
}
