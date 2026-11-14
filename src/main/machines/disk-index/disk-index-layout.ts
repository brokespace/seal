/** A folder was modified so recently, or holds files that change in place, that its size is re-read every scan. */
export const NODE_RESCAN = 1
export const NODE_UNREADABLE = 2
/** Another filesystem is mounted here, or the folder is deliberately left out; never descended. */
export const NODE_STUB = 4

export const DISK_INDEX_FORMAT_VERSION = 1
const MAGIC = 0x58494453
const PREAMBLE_BYTES = 8

export type DiskIndexLargestFile = {
  /** Node of the folder holding the file. */
  dir: number
  name: string
  bytes: number
  mtimeMs: number
}

export type DiskIndexSummary = {
  version: number
  root: string
  nodeCount: number
  namesBytes: number
  startedAt: number
  scannedAt: number
  durationMs: number
  mode: 'full' | 'incremental'
  /** When every folder was last read from disk rather than carried over. */
  lastFullAt: number
  totalBytes: number
  totalFiles: number
  foldersRead: number
  foldersReused: number
  unreadableFolders: number
  largestFiles: DiskIndexLargestFile[]
}

/**
 * Folders of one filesystem in depth-first pre-order: a folder's subtree is the contiguous range
 * `[node, subtreeEnd[node])`, so its children are found without any pointer structure.
 */
export type DiskIndex = {
  summary: DiskIndexSummary
  mtimeMs: Float64Array
  ino: Float64Array
  /** Files directly inside the folder plus the folder's own blocks. */
  ownBytes: Float64Array
  totalBytes: Float64Array
  totalFiles: Float64Array
  parent: Int32Array
  subtreeEnd: Int32Array
  ownFiles: Uint32Array
  /** `nodeCount + 1` offsets into `names`. */
  nameStart: Uint32Array
  flags: Uint8Array
  names: Uint8Array
}

export type DiskIndexArrays = Omit<DiskIndex, 'summary'>

type SectionName = keyof DiskIndexArrays

const SECTIONS: readonly { name: SectionName; bytesPerItem: number; extraItems: number }[] = [
  { name: 'mtimeMs', bytesPerItem: 8, extraItems: 0 },
  { name: 'ino', bytesPerItem: 8, extraItems: 0 },
  { name: 'ownBytes', bytesPerItem: 8, extraItems: 0 },
  { name: 'totalBytes', bytesPerItem: 8, extraItems: 0 },
  { name: 'totalFiles', bytesPerItem: 8, extraItems: 0 },
  { name: 'parent', bytesPerItem: 4, extraItems: 0 },
  { name: 'subtreeEnd', bytesPerItem: 4, extraItems: 0 },
  { name: 'ownFiles', bytesPerItem: 4, extraItems: 0 },
  { name: 'nameStart', bytesPerItem: 4, extraItems: 1 },
  { name: 'flags', bytesPerItem: 1, extraItems: 0 }
]

function align8(value: number): number {
  return (value + 7) & ~7
}

type SectionSpan = { name: SectionName; offset: number; items: number; bytes: number }

function sectionSpans(
  headerBytes: number,
  nodeCount: number,
  namesBytes: number
): { spans: SectionSpan[]; totalBytes: number } {
  let offset = align8(PREAMBLE_BYTES + headerBytes)
  const spans: SectionSpan[] = []
  for (const section of SECTIONS) {
    const items = nodeCount + section.extraItems
    const bytes = items * section.bytesPerItem
    spans.push({ name: section.name, offset, items, bytes })
    offset = align8(offset + bytes)
  }
  spans.push({ name: 'names', offset, items: namesBytes, bytes: namesBytes })
  return { spans, totalBytes: align8(offset + namesBytes) }
}

export function parseDiskIndexSummary(header: Uint8Array): DiskIndexSummary | null {
  try {
    const summary: DiskIndexSummary = JSON.parse(Buffer.from(header).toString('utf8'))
    return summary.version === DISK_INDEX_FORMAT_VERSION && Number.isInteger(summary.nodeCount)
      ? summary
      : null
  } catch {
    return null
  }
}

/** Header length of an index file given its first eight bytes; null when it is not one. */
export function diskIndexHeaderBytes(preamble: Uint8Array): number | null {
  if (preamble.byteLength < PREAMBLE_BYTES) {
    return null
  }
  const view = new DataView(preamble.buffer, preamble.byteOffset, PREAMBLE_BYTES)
  return view.getUint32(0, true) === MAGIC ? view.getUint32(4, true) : null
}

export const DISK_INDEX_PREAMBLE_BYTES = PREAMBLE_BYTES

/** Views over a whole index file; null when the bytes are not a usable index. */
export function viewDiskIndex(buffer: ArrayBufferLike): DiskIndex | null {
  const headerBytes = diskIndexHeaderBytes(new Uint8Array(buffer, 0, PREAMBLE_BYTES))
  if (headerBytes === null || PREAMBLE_BYTES + headerBytes > buffer.byteLength) {
    return null
  }
  const summary = parseDiskIndexSummary(new Uint8Array(buffer, PREAMBLE_BYTES, headerBytes))
  if (!summary) {
    return null
  }
  const { spans, totalBytes } = sectionSpans(headerBytes, summary.nodeCount, summary.namesBytes)
  if (totalBytes > buffer.byteLength) {
    return null
  }
  const at = (name: SectionName): [ArrayBufferLike, number, number] => {
    const span = spans.find((candidate) => candidate.name === name)
    return [buffer, span?.offset ?? 0, span?.items ?? 0]
  }
  return {
    summary,
    mtimeMs: new Float64Array(...at('mtimeMs')),
    ino: new Float64Array(...at('ino')),
    ownBytes: new Float64Array(...at('ownBytes')),
    totalBytes: new Float64Array(...at('totalBytes')),
    totalFiles: new Float64Array(...at('totalFiles')),
    parent: new Int32Array(...at('parent')),
    subtreeEnd: new Int32Array(...at('subtreeEnd')),
    ownFiles: new Uint32Array(...at('ownFiles')),
    nameStart: new Uint32Array(...at('nameStart')),
    flags: new Uint8Array(...at('flags')),
    names: new Uint8Array(...at('names'))
  }
}

/** The file image of an index, as the chunks to write in order. */
export function encodeDiskIndex(summary: DiskIndexSummary, arrays: DiskIndexArrays): Uint8Array[] {
  const header = Buffer.from(JSON.stringify(summary), 'utf8')
  const { spans, totalBytes } = sectionSpans(
    header.byteLength,
    summary.nodeCount,
    summary.namesBytes
  )
  const preamble = new Uint8Array(PREAMBLE_BYTES)
  const preambleView = new DataView(preamble.buffer)
  preambleView.setUint32(0, MAGIC, true)
  preambleView.setUint32(4, header.byteLength, true)
  const chunks: Uint8Array[] = [preamble, header]
  let written = PREAMBLE_BYTES + header.byteLength
  const pad = (target: number): void => {
    if (target > written) {
      chunks.push(new Uint8Array(target - written))
      written = target
    }
  }
  for (const span of spans) {
    pad(span.offset)
    const view = arrays[span.name]
    chunks.push(new Uint8Array(view.buffer, view.byteOffset, span.bytes))
    written += span.bytes
  }
  pad(totalBytes)
  return chunks
}
