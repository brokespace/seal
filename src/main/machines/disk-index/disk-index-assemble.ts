import {
  DISK_INDEX_FORMAT_VERSION,
  NODE_UNREADABLE,
  type DiskIndexArrays,
  type DiskIndexLargestFile,
  type DiskIndexSummary
} from './disk-index-layout'
import { LARGEST_FILES_KEPT, RECORD_FIELDS } from './disk-index-walk-protocol'

/** Folder records as walkers report them: indexed by the id each folder was given, in no useful order. */
export class FolderRecords {
  parent: Int32Array
  reusedFrom: Int32Array
  mtimeMs: Float64Array
  ino: Float64Array
  ownBytes: Float64Array
  ownFiles: Uint32Array
  flags: Uint8Array
  nameBatch: Uint32Array
  nameOffset: Uint32Array
  nameLength: Uint32Array
  readonly nameBatches: Uint8Array[] = []

  constructor(private capacity: number) {
    this.parent = new Int32Array(capacity)
    this.reusedFrom = new Int32Array(capacity)
    this.mtimeMs = new Float64Array(capacity)
    this.ino = new Float64Array(capacity)
    this.ownBytes = new Float64Array(capacity)
    this.ownFiles = new Uint32Array(capacity)
    this.flags = new Uint8Array(capacity)
    this.nameBatch = new Uint32Array(capacity)
    this.nameOffset = new Uint32Array(capacity)
    this.nameLength = new Uint32Array(capacity)
  }

  private grow(needed: number): void {
    let capacity = this.capacity
    while (capacity < needed) {
      capacity *= 2
    }
    const int32 = (old: Int32Array): Int32Array => {
      const next = new Int32Array(capacity)
      next.set(old)
      return next
    }
    const uint32 = (old: Uint32Array): Uint32Array => {
      const next = new Uint32Array(capacity)
      next.set(old)
      return next
    }
    const float64 = (old: Float64Array): Float64Array => {
      const next = new Float64Array(capacity)
      next.set(old)
      return next
    }
    const flags = new Uint8Array(capacity)
    flags.set(this.flags)
    this.flags = flags
    this.parent = int32(this.parent)
    this.reusedFrom = int32(this.reusedFrom)
    this.mtimeMs = float64(this.mtimeMs)
    this.ino = float64(this.ino)
    this.ownBytes = float64(this.ownBytes)
    this.ownFiles = uint32(this.ownFiles)
    this.nameBatch = uint32(this.nameBatch)
    this.nameOffset = uint32(this.nameOffset)
    this.nameLength = uint32(this.nameLength)
    this.capacity = capacity
  }

  addBatch(folders: number, records: Float64Array, names: Uint8Array): void {
    const batch = this.nameBatches.push(names) - 1
    for (let at = 0, end = folders * RECORD_FIELDS; at < end; at += RECORD_FIELDS) {
      const id = records[at]
      if (id >= this.capacity) {
        this.grow(id + 1)
      }
      this.parent[id] = records[at + 1]
      this.mtimeMs[id] = records[at + 2]
      this.ino[id] = records[at + 3]
      this.ownBytes[id] = records[at + 4]
      this.ownFiles[id] = records[at + 5]
      this.flags[id] = records[at + 6]
      this.reusedFrom[id] = records[at + 7]
      this.nameBatch[id] = batch
      this.nameOffset[id] = records[at + 8]
      // Offset by one so an id that never reported is told apart from the nameless root.
      this.nameLength[id] = records[at + 9] + 1
    }
  }
}

export type AssembledDiskIndex = { summary: DiskIndexSummary; arrays: DiskIndexArrays }

export type AssembleInput = {
  root: string
  records: FolderRecords
  /** One past the highest id handed out. */
  idCount: number
  largestFiles: DiskIndexLargestFile[]
  startedAt: number
  scannedAt: number
  mode: 'full' | 'incremental'
  lastFullAt: number
  foldersReused: number
}

/** Orders the reported folders depth-first and adds every subtree up. */
export function assembleDiskIndex(input: AssembleInput): AssembledDiskIndex {
  const { records, idCount } = input
  const firstChild = new Int32Array(idCount).fill(-1)
  const nextSibling = new Int32Array(idCount).fill(-1)
  for (let id = idCount - 1; id >= 1; id--) {
    if (records.nameLength[id] === 0) {
      continue
    }
    const parent = records.parent[id]
    nextSibling[id] = firstChild[parent]
    firstChild[parent] = id
  }

  const order = new Int32Array(idCount)
  const position = new Int32Array(idCount).fill(-1)
  const subtreeEndById = new Int32Array(idCount)
  let nodeCount = 0
  let namesBytes = 0
  for (let id = 0, walking = records.nameLength[0] !== 0; walking;) {
    position[id] = nodeCount
    order[nodeCount++] = id
    namesBytes += records.nameLength[id] - 1
    if (firstChild[id] !== -1) {
      id = firstChild[id]
      continue
    }
    for (;;) {
      subtreeEndById[id] = nodeCount
      if (id === 0) {
        walking = false
        break
      }
      if (nextSibling[id] !== -1) {
        id = nextSibling[id]
        break
      }
      id = records.parent[id]
    }
  }

  const arrays: DiskIndexArrays = {
    mtimeMs: new Float64Array(nodeCount),
    ino: new Float64Array(nodeCount),
    ownBytes: new Float64Array(nodeCount),
    totalBytes: new Float64Array(nodeCount),
    totalFiles: new Float64Array(nodeCount),
    parent: new Int32Array(nodeCount),
    subtreeEnd: new Int32Array(nodeCount),
    ownFiles: new Uint32Array(nodeCount),
    nameStart: new Uint32Array(nodeCount + 1),
    flags: new Uint8Array(nodeCount),
    names: new Uint8Array(namesBytes)
  }
  let nameAt = 0
  let unreadableFolders = 0
  for (let node = 0; node < nodeCount; node++) {
    const id = order[node]
    arrays.mtimeMs[node] = records.mtimeMs[id]
    arrays.ino[node] = records.ino[id]
    arrays.ownBytes[node] = records.ownBytes[id]
    arrays.ownFiles[node] = records.ownFiles[id]
    arrays.flags[node] = records.flags[id]
    arrays.parent[node] = node === 0 ? -1 : position[records.parent[id]]
    arrays.subtreeEnd[node] = subtreeEndById[id]
    arrays.nameStart[node] = nameAt
    const length = records.nameLength[id] - 1
    const offset = records.nameOffset[id]
    arrays.names.set(
      records.nameBatches[records.nameBatch[id]].subarray(offset, offset + length),
      nameAt
    )
    nameAt += length
    if (records.flags[id] & NODE_UNREADABLE) {
      unreadableFolders += 1
    }
  }
  arrays.nameStart[nodeCount] = nameAt
  // Pre-order puts every child after its parent, so one backward pass adds each subtree up.
  for (let node = nodeCount - 1; node >= 0; node--) {
    arrays.totalBytes[node] += arrays.ownBytes[node]
    arrays.totalFiles[node] += arrays.ownFiles[node]
    const parent = arrays.parent[node]
    if (parent >= 0) {
      arrays.totalBytes[parent] += arrays.totalBytes[node]
      arrays.totalFiles[parent] += arrays.totalFiles[node]
    }
  }

  const largestFiles = input.largestFiles
    .filter((file) => file.dir < idCount && position[file.dir] >= 0)
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, LARGEST_FILES_KEPT)
    .map((file) => ({ ...file, dir: position[file.dir] }))
  const summary: DiskIndexSummary = {
    version: DISK_INDEX_FORMAT_VERSION,
    root: input.root,
    nodeCount,
    namesBytes,
    startedAt: input.startedAt,
    scannedAt: input.scannedAt,
    durationMs: input.scannedAt - input.startedAt,
    mode: input.mode,
    lastFullAt: input.lastFullAt,
    totalBytes: nodeCount > 0 ? arrays.totalBytes[0] : 0,
    totalFiles: nodeCount > 0 ? arrays.totalFiles[0] : 0,
    foldersRead: nodeCount - input.foldersReused,
    foldersReused: input.foldersReused,
    unreadableFolders,
    largestFiles
  }
  return { summary, arrays }
}
