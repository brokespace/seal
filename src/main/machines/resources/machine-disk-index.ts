import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type {
  MachineDiskIndexReply,
  MachineDiskIndexRequest
} from '../../../shared/machines/machine-disk-index-types'
import type { MachineExecResult } from '../../../shared/machines/machine-host-wire'
import { joinMachinePath } from '../../../shared/machines/machine-paths'
import type { MachineId } from '../../../shared/machines/machine-types'
import { getForkedChildEntryPath } from '../../worker-threads/forked-child-entry-path'
import type { MachineConnection } from '../connection/machine-connection'
import { logDiskIndexStart } from './machine-disk-index-log'
import {
  buildDiskIndexScript,
  DISK_INDEX_NO_DAEMON,
  DISK_INDEX_NO_NODE,
  DISK_INDEX_NO_PROGRAM,
  DISK_INDEX_REMOTE_DIR
} from './machine-disk-index-script'
import { answerDiskRequestLive, type DiskIndexFailure } from './machine-disk-live-answer'
import { firstErrorLine, runMachineHostScript } from './machine-host-script'

const PROGRAM_ENTRY = 'disk-usage-index-entry.js'
const QUERY_TIMEOUT_MS = 90_000
/** How long a machine that cannot run the index is served live before it is asked again. */
const UNAVAILABLE_RETRY_MS = 2 * 60_000
/** A machine whose index answers is asked again this often, which also keeps a remote daemon from idling out. */
const ENSURE_HEALTHY_EVERY_MS = 30 * 60_000
const ENSURE_RETRY_AFTER_MS = [60_000, 5 * 60_000, 30 * 60_000]
const DETAIL_MAX_CHARS = 400

type Program = { name: string; bytes: Buffer }
type Outcome = { reply: MachineDiskIndexReply } | { marker: string; said: string | null }

let program: Promise<Program> | null = null
const unavailable = new Map<MachineId, DiskIndexFailure & { at: number }>()

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

async function installProgram(connection: MachineConnection, build: Program): Promise<string> {
  const dir = joinMachinePath(await connection.files.homeDir(), DISK_INDEX_REMOTE_DIR)
  await connection.files.createDir(dir)
  await connection.files.writeFile(joinMachinePath(dir, build.name), build.bytes)
  return dir
}

function messageOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, DETAIL_MAX_CHARS)
}

/** The script's last line is the daemon's JSON reply or a marker; what came before a marker is the machine's reason. */
function readOutcome(result: MachineExecResult): Outcome {
  const lines = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const last = lines.at(-1) ?? ''
  if (last.startsWith('{')) {
    try {
      const reply: MachineDiskIndexReply = JSON.parse(last)
      return { reply }
    } catch {
      return { marker: '', said: 'The disk index sent an unreadable reply.' }
    }
  }
  if (!last.startsWith('@')) {
    return { marker: '', said: firstErrorLine(result).slice(0, DETAIL_MAX_CHARS) }
  }
  const said = lines.slice(0, -1).join(' | ') || result.stderr.trim().split(/\r?\n/).at(-1) || ''
  return { marker: last, said: said.slice(0, DETAIL_MAX_CHARS) || null }
}

/** Asks the daemon, starting it and copying the program over first where needed. */
async function askIndex(
  connection: MachineConnection,
  request: MachineDiskIndexRequest,
  signal?: AbortSignal
): Promise<MachineDiskIndexReply | DiskIndexFailure> {
  let build: Program
  try {
    build = await loadProgram()
  } catch (error) {
    return { reason: 'no-program', detail: messageOf(error) }
  }
  // This computer needs no Node of its own: the index runs on the runtime Seal itself runs on.
  const local =
    connection.transport === 'local' ? { node: process.execPath, ownerPid: process.pid } : null
  const script = buildDiskIndexScript({ programName: build.name, request, local })
  const run = async (): Promise<Outcome> =>
    readOutcome(
      await runMachineHostScript(connection, script, {
        timeoutMs: QUERY_TIMEOUT_MS,
        ...(signal ? { signal } : {})
      })
    )
  let outcome = await run()
  if ('marker' in outcome && outcome.marker === DISK_INDEX_NO_PROGRAM) {
    let installedIn: string
    try {
      installedIn = await installProgram(connection, build)
    } catch (error) {
      return { reason: 'install-failed', detail: messageOf(error) }
    }
    outcome = await run()
    if ('marker' in outcome && outcome.marker === DISK_INDEX_NO_PROGRAM) {
      return {
        reason: 'install-failed',
        detail: `The program was copied to ${installedIn}, but the machine's shell does not find it under its home folder.`
      }
    }
  }
  if ('reply' in outcome) {
    return outcome.reply
  }
  if (outcome.marker === DISK_INDEX_NO_NODE) {
    return { reason: 'no-node', detail: null }
  }
  return {
    reason: outcome.marker === DISK_INDEX_NO_DAEMON ? 'daemon-failed' : 'command-failed',
    detail: outcome.said
  }
}

/**
 * One question to a machine's disk-usage index. The index daemon is started on first use and the
 * program is copied over when the machine does not have this build yet; both go through the
 * machine's ordinary command and file channels, so every transport behaves the same. A machine
 * whose index cannot answer is measured on demand, and the reply says which step failed.
 */
export async function queryMachineDiskIndex(
  connection: MachineConnection,
  request: MachineDiskIndexRequest,
  signal?: AbortSignal
): Promise<MachineDiskIndexReply> {
  const known = unavailable.get(connection.machineId)
  if (known && Date.now() - known.at < UNAVAILABLE_RETRY_MS) {
    return answerDiskRequestLive(connection, request, known, signal)
  }
  const answer = await askIndex(connection, request, signal).catch((error: unknown) => {
    if (!signal?.aborted) {
      logDiskIndexStart(connection, {
        outcome: 'failed',
        reason: 'command-failed',
        detail: messageOf(error)
      })
    }
    throw error
  })
  if (!('reason' in answer)) {
    unavailable.delete(connection.machineId)
    logDiskIndexStart(connection, { outcome: 'answering' })
    return answer
  }
  unavailable.set(connection.machineId, { ...answer, at: Date.now() })
  logDiskIndexStart(connection, { outcome: 'failed', ...answer })
  return answerDiskRequestLive(connection, request, answer, signal)
}

type Ensured = { nextAt: number; failures: number; asking: boolean }

const ensured = new Map<MachineId, Ensured>()

async function startIndex(connection: MachineConnection): Promise<boolean> {
  if ((await connection.dialect()) !== 'posix') {
    logDiskIndexStart(connection, {
      outcome: 'skipped',
      detail: 'the index runs on Linux and macOS machines only'
    })
    return true
  }
  // A start is a real attempt, never the remembered failure.
  unavailable.delete(connection.machineId)
  const reply = await queryMachineDiskIndex(connection, { op: 'status' })
  return 'status' in reply && reply.status.source === 'index'
}

/**
 * Starts a machine's index daemon without anyone opening the disk panel, so the index is already
 * there when they do. Safe to call often: a machine is only asked when it is due, and one that
 * fails is retried with growing pauses.
 */
export function ensureMachineDiskIndex(connection: MachineConnection): void {
  const machineId = connection.machineId
  const state = ensured.get(machineId) ?? { nextAt: 0, failures: 0, asking: false }
  ensured.set(machineId, state)
  if (state.asking || Date.now() < state.nextAt) {
    return
  }
  state.asking = true
  void startIndex(connection)
    .catch((error: unknown) => {
      logDiskIndexStart(connection, {
        outcome: 'failed',
        reason: 'command-failed',
        detail: messageOf(error)
      })
      return false
    })
    .then((answering) => {
      state.asking = false
      state.failures = answering ? 0 : state.failures + 1
      state.nextAt =
        Date.now() +
        (answering
          ? ENSURE_HEALTHY_EVERY_MS
          : ENSURE_RETRY_AFTER_MS[Math.min(state.failures, ENSURE_RETRY_AFTER_MS.length) - 1])
    })
}
