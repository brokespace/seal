/**
 * The disk-usage index program. One self-contained file with no dependencies beyond Node, so the
 * same build runs under the desktop app, under a Seal server and, copied over, on an SSH machine.
 *
 *   daemon   keeps every local disk's index fresh in the background and answers queries
 *   query    asks the running daemon one question and prints the JSON reply (exit 3: no daemon)
 *   scan     indexes one folder once and prints the timings; used for benchmarks
 */
import { lstatSync, readdirSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { availableParallelism, constants, homedir, setPriority } from 'node:os'
import { basename, join } from 'node:path'
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads'
import type { MachineDiskIndexRequest } from '../../../shared/machines/machine-disk-index-types'
import { DiskIndexDaemon } from './disk-index-daemon'
import type { DiskIndexSummary } from './disk-index-layout'
import { runDiskScan, type DiskScanHost, type DiskScanPlan } from './disk-index-scan'
import {
  writeScanProgress,
  writeScanStart,
  type ScanProgressCounters
} from './disk-index-scan-progress'
import {
  diskIndexSocketPath,
  listenForDiskIndexRequests,
  requestDiskIndexDaemon
} from './disk-index-socket'
import type { WalkerInit, WalkerMessage } from './disk-index-walk-protocol'
import { DiskWalker } from './disk-index-walker'

/** The program file's name carries a hash of its contents. */
const BUILD = basename(__filename)
const NO_DAEMON_EXIT_CODE = 3
const QUERY_TIMEOUT_MS = 60_000
const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS

type ThreadRole =
  | { role: 'walk'; init: WalkerInit }
  | { role: 'scan'; plan: DiskScanPlan; progress: SharedArrayBuffer }

type ScanOutcome = { ok: true; summary: DiskIndexSummary } | { ok: false; message: string }

/** V8 reserves ~600 MB of address space per thread unless told otherwise; walkers need little. */
const THREAD_CODE_RANGE_MB = 64

function spawnThread(role: ThreadRole): Worker {
  // This program is copied to machines as one file, so it cannot share spawnWorkerThread's module.
  // ast-grep-ignore: main-worker-thread-spawn -- Same limit as spawnWorkerThread, set here directly.
  return new Worker(__filename, {
    workerData: role,
    resourceLimits: { codeRangeSizeMb: THREAD_CODE_RANGE_MB }
  })
}

function scanHost(progress: ScanProgressCounters | null): DiskScanHost {
  return {
    createWalker: (init) => {
      const thread = spawnThread({ role: 'walk', init })
      return {
        post: (command) => thread.postMessage(command),
        listen: (onMessage, onError) => {
          thread.on('message', onMessage)
          thread.on('error', onError)
        },
        close: () => void thread.terminate()
      }
    },
    onStart: (expectedFolders, mode) => {
      if (progress) {
        writeScanStart(progress, expectedFolders, mode === 'incremental')
      }
    },
    onProgress: (current) => {
      if (progress) {
        writeScanProgress(progress, current)
      }
    }
  }
}

function runThread(data: ThreadRole): void {
  const port = parentPort!
  if (data.role === 'walk') {
    const walker = new DiskWalker(
      {
        readdir: (path) => readdirSync(path),
        lstat: (path) => lstatSync(path, { throwIfNoEntry: false })
      },
      data.init,
      (message: WalkerMessage) =>
        port.postMessage(
          message,
          message.type === 'batch' ? [message.records.buffer, message.names.buffer] : []
        )
    )
    port.on('message', (command) => walker.handle(command))
    return
  }
  void runDiskScan(data.plan, scanHost(new Float64Array(data.progress))).then(
    (summary) => port.postMessage({ ok: true, summary } satisfies ScanOutcome),
    (error: unknown) =>
      port.postMessage({
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      } satisfies ScanOutcome)
  )
}

/** The whole scan runs on its own thread so the daemon keeps answering queries meanwhile. */
function scanOnThread(
  plan: DiskScanPlan,
  progress: ScanProgressCounters
): Promise<DiskIndexSummary> {
  return new Promise((resolve, reject) => {
    const thread = spawnThread({ role: 'scan', plan, progress: progress.buffer })
    thread.once('message', (outcome: ScanOutcome) => {
      void thread.terminate()
      if (outcome.ok) {
        resolve(outcome.summary)
      } else {
        reject(new Error(outcome.message))
      }
    })
    thread.once('error', reject)
    thread.once('exit', () => reject(new Error('The scan stopped before it finished.')))
  })
}

function flagValue(args: string[], name: string): number | null {
  const at = args.indexOf(name)
  const value = at !== -1 ? Number(args[at + 1]) : Number.NaN
  return Number.isFinite(value) ? value : null
}

function defaultWalkers(): number {
  return Math.min(8, Math.max(1, Math.floor(availableParallelism() / 2)))
}

function dataDir(): string {
  return process.env.SEAL_DISK_INDEX_DIR || join(homedir(), '.seal', 'disk-index')
}

async function runDaemon(args: string[]): Promise<void> {
  try {
    // Threads started later inherit this, so the walkers yield to everything else.
    setPriority(constants.priority.PRIORITY_LOW)
  } catch {
    // Scanning at normal priority is still better than not scanning.
  }
  const idleExitHours = flagValue(args, '--idle-exit-hours')
  await mkdir(dataDir(), { recursive: true, mode: 0o700 })
  let ready: Promise<void> | null = null
  let daemon: DiskIndexDaemon | null = null
  const listener = await listenForDiskIndexRequests(
    diskIndexSocketPath(dataDir()),
    BUILD,
    async (envelope) => {
      await ready
      return daemon!.handle(envelope)
    }
  )
  if (!listener) {
    return
  }
  daemon = new DiskIndexDaemon({
    dataDir: dataDir(),
    build: BUILD,
    stillOwnsSocket: listener.stillOwnsSocket,
    ownerPid: flagValue(args, '--owner-pid'),
    idleExitMs: idleExitHours === null ? null : idleExitHours * HOUR_MS,
    walkers: flagValue(args, '--walkers') ?? defaultWalkers(),
    intervalMs: flagValue(args, '--interval-ms') ?? 30 * MINUTE_MS,
    fullIntervalMs: flagValue(args, '--full-interval-ms') ?? 24 * HOUR_MS,
    hotWindowMs: flagValue(args, '--hot-window-ms') ?? 7 * 24 * HOUR_MS,
    runScan: scanOnThread,
    // The socket file is left for the next daemon to clear: closing it here could unlink a successor's.
    exit: () => process.exit(0)
  })
  ready = daemon.start()
  await ready
}

async function runQuery(encoded: string): Promise<void> {
  const request: MachineDiskIndexRequest = JSON.parse(
    Buffer.from(encoded, 'base64').toString('utf8')
  )
  const reply = await requestDiskIndexDaemon(
    diskIndexSocketPath(dataDir()),
    BUILD,
    request,
    QUERY_TIMEOUT_MS
  ).catch(() => null)
  if (!reply || 'superseded' in reply) {
    process.exitCode = NO_DAEMON_EXIT_CODE
    return
  }
  process.stdout.write(`${JSON.stringify(reply)}\n`)
}

async function runOneScan(args: string[]): Promise<void> {
  const root = args[0]
  const summary = await runDiskScan(
    {
      root,
      indexPath: join(dataDir(), 'scan.bin'),
      sameDiskPaths: [],
      anyDev: false,
      stops: [],
      walkers: flagValue(args, '--walkers') ?? defaultWalkers(),
      hotWindowMs: flagValue(args, '--hot-window-ms') ?? 7 * 24 * HOUR_MS,
      full: args.includes('--full')
    },
    scanHost(null)
  )
  process.stdout.write(`${JSON.stringify({ ...summary, largestFiles: undefined })}\n`)
}

async function main(): Promise<void> {
  const [mode, ...args] = process.argv.slice(2)
  if (mode === 'daemon') {
    await runDaemon(args)
  } else if (mode === 'query' && args[0]) {
    await runQuery(args[0])
  } else if (mode === 'scan' && args[0]) {
    await runOneScan(args)
  } else {
    process.stderr.write('usage: disk-usage-index (daemon | query <request> | scan <folder>)\n')
    process.exitCode = 2
  }
}

if (isMainThread) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
} else {
  const role: ThreadRole = workerData
  runThread(role)
}
