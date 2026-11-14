import {
  NODE_RESCAN,
  NODE_STUB,
  NODE_UNREADABLE,
  viewDiskIndex,
  type DiskIndex,
  type DiskIndexLargestFile
} from './disk-index-layout'
import {
  COUNTER_IDLE_WALKERS,
  COUNTER_NEXT_ID,
  LARGEST_FILES_KEPT,
  RECORD_FIELDS,
  type WalkFs,
  type WalkStat,
  type WalkTask,
  type WalkerCommand,
  type WalkerInit,
  type WalkerMessage
} from './disk-index-walk-protocol'

const BATCH_FOLDERS = 2048
const BATCH_NAME_BYTES = 512 * 1024
const LONGEST_NAME_BYTES = 4096
const DONATE_EVERY_FOLDERS = 64
const BLOCK_BYTES = 512

const encoder = new TextEncoder()

export class DiskWalker {
  private readonly counters: Int32Array
  private readonly stops: Set<string>
  private readonly allowedDevs: Set<number>
  private readonly previous: DiskIndex | null
  private readonly previousNames: Buffer | null
  private readonly stack: WalkTask[] = []
  private records = new Float64Array(BATCH_FOLDERS * RECORD_FIELDS)
  private names = new Uint8Array(BATCH_NAME_BYTES)
  private batchFolders = 0
  private batchNameBytes = 0
  private batchFiles = 0
  private batchBytes = 0
  private batchReused = 0
  private sinceDonation = 0
  private largest: DiskIndexLargestFile[] = []
  private largestFloor = 0

  constructor(
    private readonly fs: WalkFs,
    private readonly init: WalkerInit,
    private readonly send: (message: WalkerMessage) => void
  ) {
    this.counters = new Int32Array(init.counters)
    this.stops = new Set(init.stops)
    this.allowedDevs = new Set([init.rootDev, ...init.allowedDevs])
    this.previous = init.previous ? viewDiskIndex(init.previous) : null
    this.previousNames = this.previous
      ? Buffer.from(
          this.previous.names.buffer,
          this.previous.names.byteOffset,
          this.previous.names.byteLength
        )
      : null
  }

  handle(command: WalkerCommand): void {
    if (command.type === 'finish') {
      this.trimLargest()
      this.send({ type: 'largest', files: this.largest })
      return
    }
    this.stack.push(...command.tasks)
    while (this.stack.length > 0) {
      this.visit(this.stack.pop()!)
      this.sinceDonation += 1
      if (
        this.stack.length > 1 &&
        this.sinceDonation >= DONATE_EVERY_FOLDERS &&
        Atomics.load(this.counters, COUNTER_IDLE_WALKERS) > 0
      ) {
        this.sinceDonation = 0
        // The oldest entries sit nearest the root, so they are the largest subtrees to hand over.
        this.send({ type: 'donate', tasks: this.stack.splice(0, this.stack.length >> 1) })
      }
    }
    this.flush()
    this.send({ type: 'idle' })
  }

  private visit(task: WalkTask): void {
    const previous = this.previous
    const prev = task.prev
    if (
      previous &&
      prev >= 0 &&
      previous.mtimeMs[prev] === task.mtimeMs &&
      previous.ino[prev] === task.ino &&
      (previous.flags[prev] & (NODE_RESCAN | NODE_UNREADABLE | NODE_STUB)) === 0
    ) {
      this.reuse(task, previous, prev)
      return
    }
    this.read(task)
  }

  /** The folder's own entries are unchanged, so only its subfolders are looked at again. */
  private reuse(task: WalkTask, previous: DiskIndex, prev: number): void {
    const base = task.path === '/' ? '/' : `${task.path}/`
    let unreadable = false
    for (let child = prev + 1, end = previous.subtreeEnd[prev]; child < end;) {
      const name = this.previousNames!.toString(
        'utf8',
        previous.nameStart[child],
        previous.nameStart[child + 1]
      )
      const stat = this.statOrNull(base + name)
      if (stat === null) {
        unreadable = true
      } else if (stat?.isDirectory()) {
        this.enter(task, name, base + name, stat, child)
      }
      child = previous.subtreeEnd[child]
    }
    this.batchReused += 1
    this.record(task, previous.ownBytes[prev], previous.ownFiles[prev], unreadable, prev)
  }

  private read(task: WalkTask): void {
    let entries: string[]
    try {
      entries = this.fs.readdir(task.path)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      this.record(task, task.selfBytes, 0, code !== 'ENOENT' && code !== 'ENOTDIR', -1)
      return
    }
    const base = task.path === '/' ? '/' : `${task.path}/`
    let previousChildren: Map<string, number> | null = null
    let ownBytes = task.selfBytes
    let ownFiles = 0
    let hot = task.mtimeMs >= this.init.racyAfterMs
    let unreadable = false
    for (const name of entries) {
      const path = base + name
      const stat = this.statOrNull(path)
      if (!stat) {
        unreadable ||= stat === null
        continue
      }
      if (stat.isDirectory()) {
        previousChildren ??= this.previousChildren(task.prev)
        this.enter(task, name, path, stat, previousChildren.get(name) ?? -1)
        continue
      }
      const allocated = stat.blocks * BLOCK_BYTES
      // Each hard link carries an equal share, so a filesystem's total counts the data once.
      ownBytes += stat.nlink > 1 ? allocated / stat.nlink : allocated
      ownFiles += 1
      hot ||= stat.mtimeMs >= this.init.hotAfterMs
      if (allocated > this.largestFloor) {
        this.offerLargest(task.id, name, allocated, stat.mtimeMs)
      }
    }
    this.record(task, ownBytes, ownFiles, unreadable, -1, hot ? NODE_RESCAN : 0)
  }

  private statOrNull(path: string): WalkStat | undefined | null {
    try {
      return this.fs.lstat(path)
    } catch {
      return null
    }
  }

  private previousChildren(prev: number): Map<string, number> {
    const children = new Map<string, number>()
    const previous = this.previous
    if (!previous || prev < 0) {
      return children
    }
    for (let child = prev + 1, end = previous.subtreeEnd[prev]; child < end;) {
      children.set(
        this.previousNames!.toString(
          'utf8',
          previous.nameStart[child],
          previous.nameStart[child + 1]
        ),
        child
      )
      child = previous.subtreeEnd[child]
    }
    return children
  }

  private enter(parent: WalkTask, name: string, path: string, stat: WalkStat, prev: number): void {
    const id = Atomics.add(this.counters, COUNTER_NEXT_ID, 1)
    const task: WalkTask = {
      id,
      parent: parent.id,
      name,
      path,
      prev,
      mtimeMs: stat.mtimeMs,
      ino: stat.ino,
      selfBytes: stat.blocks * BLOCK_BYTES
    }
    if (this.stops.has(path) || (!this.init.anyDev && !this.allowedDevs.has(stat.dev))) {
      this.record(task, 0, 0, false, -1, NODE_STUB)
      return
    }
    this.stack.push(task)
  }

  private record(
    task: WalkTask,
    ownBytes: number,
    ownFiles: number,
    unreadable: boolean,
    reusedFrom: number,
    flags = 0
  ): void {
    if (
      this.batchFolders === BATCH_FOLDERS ||
      this.batchNameBytes + LONGEST_NAME_BYTES > BATCH_NAME_BYTES
    ) {
      this.flush()
    }
    const encoded = encoder.encodeInto(task.name, this.names.subarray(this.batchNameBytes))
    const at = this.batchFolders * RECORD_FIELDS
    const records = this.records
    records[at] = task.id
    records[at + 1] = task.parent
    records[at + 2] = task.mtimeMs
    records[at + 3] = task.ino
    records[at + 4] = ownBytes
    records[at + 5] = ownFiles
    records[at + 6] = flags | (unreadable ? NODE_UNREADABLE : 0)
    records[at + 7] = reusedFrom
    records[at + 8] = this.batchNameBytes
    records[at + 9] = encoded.written
    this.batchNameBytes += encoded.written
    this.batchFolders += 1
    this.batchBytes += ownBytes
    this.batchFiles += ownFiles
  }

  private flush(): void {
    if (this.batchFolders === 0) {
      return
    }
    this.send({
      type: 'batch',
      folders: this.batchFolders,
      records: this.records.slice(0, this.batchFolders * RECORD_FIELDS),
      names: this.names.slice(0, this.batchNameBytes),
      files: this.batchFiles,
      bytes: this.batchBytes,
      reused: this.batchReused
    })
    this.batchFolders = 0
    this.batchNameBytes = 0
    this.batchFiles = 0
    this.batchBytes = 0
    this.batchReused = 0
  }

  private offerLargest(dir: number, name: string, bytes: number, mtimeMs: number): void {
    this.largest.push({ dir, name, bytes, mtimeMs })
    if (this.largest.length >= LARGEST_FILES_KEPT * 2) {
      this.trimLargest()
    }
  }

  private trimLargest(): void {
    this.largest.sort((a, b) => b.bytes - a.bytes)
    if (this.largest.length > LARGEST_FILES_KEPT) {
      this.largest.length = LARGEST_FILES_KEPT
      this.largestFloor = this.largest[LARGEST_FILES_KEPT - 1].bytes
    }
  }
}
