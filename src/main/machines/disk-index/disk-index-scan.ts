import { lstat } from 'node:fs/promises'
import { assembleDiskIndex, FolderRecords } from './disk-index-assemble'
import { readDiskIndex, writeDiskIndex } from './disk-index-file'
import type { DiskIndex, DiskIndexLargestFile, DiskIndexSummary } from './disk-index-layout'
import {
  COUNTER_IDLE_WALKERS,
  COUNTER_NEXT_ID,
  COUNTER_SLOTS,
  type WalkTask,
  type WalkerCommand,
  type WalkerInit,
  type WalkerMessage
} from './disk-index-walk-protocol'

/** A folder touched this recently is re-read next scan: its timestamp may not move again. */
const RACY_WINDOW_MS = 3000
const BLOCK_BYTES = 512

export type DiskScanPlan = {
  root: string
  indexPath: string
  /** Paths whose device also belongs to this disk. */
  sameDiskPaths: string[]
  anyDev: boolean
  stops: string[]
  walkers: number
  hotWindowMs: number
  /** Read every folder instead of trusting unchanged ones from the stored index. */
  full: boolean
}

export type DiskScanProgress = { folders: number; files: number; bytes: number; reused: number }

export type WalkerPort = {
  post(command: WalkerCommand): void
  listen(onMessage: (message: WalkerMessage) => void, onError: (error: Error) => void): void
  close(): void
}

export type DiskScanHost = {
  createWalker(init: WalkerInit): WalkerPort
  onStart?(expectedFolders: number | null, mode: 'full' | 'incremental'): void
  onProgress?(progress: DiskScanProgress): void
}

async function deviceOf(path: string): Promise<number | null> {
  return lstat(path).then(
    (stat) => stat.dev,
    () => null
  )
}

function carriedLargestFiles(previous: DiskIndex, records: FolderRecords, idCount: number) {
  const idByPreviousNode = new Int32Array(previous.summary.nodeCount).fill(-1)
  for (let id = 0; id < idCount; id++) {
    if (records.nameLength[id] !== 0 && records.reusedFrom[id] >= 0) {
      idByPreviousNode[records.reusedFrom[id]] = id
    }
  }
  // Files of a folder that was not read again are still where the last scan found them.
  return previous.summary.largestFiles.flatMap((file) =>
    idByPreviousNode[file.dir] >= 0 ? [{ ...file, dir: idByPreviousNode[file.dir] }] : []
  )
}

/** Walks one filesystem with a pool of walkers and replaces its stored index. */
export async function runDiskScan(
  plan: DiskScanPlan,
  host: DiskScanHost
): Promise<DiskIndexSummary> {
  const startedAt = Date.now()
  const rootStat = await lstat(plan.root)
  const stored = plan.full ? null : await readDiskIndex(plan.indexPath, true)
  const previous = stored?.summary.root === plan.root ? stored : null
  const mode = previous ? 'incremental' : 'full'
  host.onStart?.(previous?.summary.nodeCount ?? null, mode)
  const sameDisk = await Promise.all(plan.sameDiskPaths.map(deviceOf))
  const counters = new SharedArrayBuffer(COUNTER_SLOTS * Int32Array.BYTES_PER_ELEMENT)
  const counterView = new Int32Array(counters)
  Atomics.store(counterView, COUNTER_NEXT_ID, 1)
  const init: WalkerInit = {
    rootDev: rootStat.dev,
    allowedDevs: sameDisk.filter((dev): dev is number => dev !== null),
    anyDev: plan.anyDev,
    stops: plan.stops,
    hotAfterMs: startedAt - plan.hotWindowMs,
    racyAfterMs: startedAt - RACY_WINDOW_MS,
    previous: previous?.names.buffer instanceof SharedArrayBuffer ? previous.names.buffer : null,
    counters
  }
  const records = new FolderRecords(
    Math.max(1 << 14, Math.ceil((previous?.summary.nodeCount ?? 0) * 1.1))
  )
  const progress: DiskScanProgress = { folders: 0, files: 0, bytes: 0, reused: 0 }
  const largestFiles: DiskIndexLargestFile[] = []
  const walkers = Array.from({ length: Math.max(1, plan.walkers) }, () => host.createWalker(init))
  const idle = new Set(walkers)
  const pending: WalkTask[] = [
    {
      id: 0,
      parent: -1,
      name: '',
      path: plan.root,
      prev: previous ? 0 : -1,
      mtimeMs: rootStat.mtimeMs,
      ino: rootStat.ino,
      selfBytes: rootStat.blocks * BLOCK_BYTES
    }
  ]

  try {
    await new Promise<void>((resolve, reject) => {
      let finishing = 0
      const dispatch = (): void => {
        while (pending.length > 0 && idle.size > 0) {
          const walker = idle.values().next().value!
          idle.delete(walker)
          walker.post({
            type: 'tasks',
            tasks: pending.splice(0, Math.ceil(pending.length / (idle.size + 1)))
          })
        }
        Atomics.store(counterView, COUNTER_IDLE_WALKERS, idle.size)
        if (idle.size === walkers.length && finishing === 0) {
          finishing = walkers.length
          for (const walker of walkers) {
            walker.post({ type: 'finish' })
          }
        }
      }
      for (const walker of walkers) {
        walker.listen((message) => {
          if (message.type === 'batch') {
            records.addBatch(message.folders, message.records, message.names)
            progress.folders += message.folders
            progress.files += message.files
            progress.bytes += message.bytes
            progress.reused += message.reused
            host.onProgress?.(progress)
          } else if (message.type === 'donate') {
            pending.push(...message.tasks)
            dispatch()
          } else if (message.type === 'idle') {
            idle.add(walker)
            dispatch()
          } else {
            largestFiles.push(...message.files)
            finishing -= 1
            if (finishing === 0) {
              resolve()
            }
          }
        }, reject)
      }
      dispatch()
    })
  } finally {
    for (const walker of walkers) {
      walker.close()
    }
  }

  const idCount = Atomics.load(counterView, COUNTER_NEXT_ID)
  if (previous) {
    largestFiles.push(...carriedLargestFiles(previous, records, idCount))
  }
  const scannedAt = Date.now()
  const { summary, arrays } = assembleDiskIndex({
    root: plan.root,
    records,
    idCount,
    largestFiles,
    startedAt,
    scannedAt,
    mode,
    lastFullAt: previous ? previous.summary.lastFullAt : scannedAt,
    foldersReused: progress.reused
  })
  await writeDiskIndex(plan.indexPath, summary, arrays)
  return summary
}
