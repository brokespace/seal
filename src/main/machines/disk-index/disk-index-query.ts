import { lstat, opendir } from 'node:fs/promises'
import {
  DISK_INDEX_MAX_LARGEST_ITEMS,
  DISK_INDEX_MAX_LISTING_ENTRIES,
  type MachineDiskIndexEntry,
  type MachineDiskIndexLargest,
  type MachineDiskIndexListing
} from '../../../shared/machines/machine-disk-index-types'
import { NODE_STUB, NODE_UNREADABLE, type DiskIndex } from './disk-index-layout'

/** Direct children sized live per listing; a folder with more shows only what was read. */
const MAX_LIVE_ENTRIES = 20_000
const STAT_CONCURRENCY = 32
const BLOCK_BYTES = 512

function nodeName(index: DiskIndex, node: number): string {
  return Buffer.from(
    index.names.buffer,
    index.names.byteOffset + index.nameStart[node],
    index.nameStart[node + 1] - index.nameStart[node]
  ).toString('utf8')
}

function childNodes(index: DiskIndex, node: number): Map<string, number> {
  const children = new Map<string, number>()
  for (let child = node + 1, end = index.subtreeEnd[node]; child < end;) {
    children.set(nodeName(index, child), child)
    child = index.subtreeEnd[child]
  }
  return children
}

export function diskIndexNodePath(index: DiskIndex, node: number): string {
  const parts: string[] = []
  for (let at = node; at > 0; at = index.parent[at]) {
    parts.push(nodeName(index, at))
  }
  const root = index.summary.root
  return parts.length === 0 ? root : `${root === '/' ? '' : root}/${parts.toReversed().join('/')}`
}

/** The node for an absolute path, or -1 when the index does not hold it. */
export function findDiskIndexNode(index: DiskIndex, path: string): number {
  const root = index.summary.root
  if (path === root) {
    return index.summary.nodeCount > 0 ? 0 : -1
  }
  const prefix = root === '/' ? '/' : `${root}/`
  if (!path.startsWith(prefix)) {
    return -1
  }
  let node = 0
  for (const part of path.slice(prefix.length).split('/')) {
    if (part === '') {
      continue
    }
    const child = childNodes(index, node).get(part)
    if (child === undefined) {
      return -1
    }
    node = child
  }
  return node
}

type LiveChild = { name: string; kind: MachineDiskIndexEntry['kind'] }

async function readLiveChildren(
  path: string
): Promise<{ children: LiveChild[]; truncated: boolean } | 'unreadable'> {
  let directory
  try {
    directory = await opendir(path)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      throw new Error('That folder no longer exists on this machine.')
    }
    return 'unreadable'
  }
  const children: LiveChild[] = []
  let truncated = false
  for await (const entry of directory) {
    if (children.length >= MAX_LIVE_ENTRIES) {
      truncated = true
      break
    }
    children.push({
      name: entry.name,
      kind: entry.isDirectory() ? 'directory' : entry.isSymbolicLink() ? 'symlink' : 'file'
    })
  }
  return { children, truncated }
}

async function sizeFiles(base: string, files: LiveChild[]): Promise<MachineDiskIndexEntry[]> {
  const entries: MachineDiskIndexEntry[] = []
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < files.length) {
      const file = files[next++]
      const stat = await lstat(base + file.name).catch(() => null)
      if (stat) {
        entries.push({
          name: file.name,
          path: base + file.name,
          kind: file.kind,
          bytes: stat.blocks * BLOCK_BYTES,
          files: null,
          mtimeMs: stat.mtimeMs,
          notIndexed: false,
          unreadable: false
        })
      }
    }
  }
  await Promise.all(Array.from({ length: STAT_CONCURRENCY }, worker))
  return entries
}

function folderEntry(
  index: DiskIndex | null,
  node: number | undefined,
  name: string,
  path: string
): MachineDiskIndexEntry {
  const flags = index && node !== undefined ? index.flags[node] : NODE_STUB
  const measured = index !== null && node !== undefined && (flags & NODE_STUB) === 0
  return {
    name,
    path,
    kind: 'directory',
    bytes: measured ? Math.round(index.totalBytes[node]) : null,
    files: measured ? index.totalFiles[node] : null,
    mtimeMs: index && node !== undefined ? index.mtimeMs[node] : null,
    notIndexed: (flags & NODE_STUB) !== 0 && node !== undefined,
    unreadable: (flags & NODE_UNREADABLE) !== 0
  }
}

function hasUnreadable(index: DiskIndex, node: number): boolean {
  return index.flags.subarray(node, index.subtreeEnd[node]).some((flags) => flags & NODE_UNREADABLE)
}

/**
 * Folder sizes come from the index; the folder's own files are sized as they are now, so nothing
 * that was deleted since the scan is listed.
 */
export async function listDiskIndexFolder(
  index: DiskIndex | null,
  path: string
): Promise<MachineDiskIndexListing> {
  const node = index ? findDiskIndexNode(index, path) : -1
  const indexed = index && node >= 0 ? childNodes(index, node) : new Map<string, number>()
  const base = path === '/' ? '/' : `${path}/`
  const live = await readLiveChildren(path)
  let entries: MachineDiskIndexEntry[]
  let incomplete = index !== null && node >= 0 && hasUnreadable(index, node)
  if (live === 'unreadable') {
    incomplete = true
    entries = [...indexed].map(([name, child]) => folderEntry(index, child, name, base + name))
  } else {
    incomplete ||= live.truncated
    entries = await sizeFiles(
      base,
      live.children.filter((child) => child.kind !== 'directory')
    )
    for (const child of live.children) {
      if (child.kind === 'directory') {
        entries.push(folderEntry(index, indexed.get(child.name), child.name, base + child.name))
      }
    }
  }
  entries.sort((a, b) => (b.bytes ?? -1) - (a.bytes ?? -1) || a.name.localeCompare(b.name))
  const omitted = entries.slice(DISK_INDEX_MAX_LISTING_ENTRIES)
  return {
    path,
    totalBytes: index && node >= 0 ? Math.round(index.totalBytes[node]) : null,
    entries: entries.slice(0, DISK_INDEX_MAX_LISTING_ENTRIES),
    omittedCount: omitted.length,
    omittedBytes: omitted.reduce((sum, entry) => sum + (entry.bytes ?? 0), 0),
    incomplete,
    scannedAt: index && node >= 0 ? index.summary.scannedAt : null
  }
}

export function largestDiskIndexFiles(index: DiskIndex): MachineDiskIndexLargest {
  return {
    kind: 'files',
    scannedAt: index.summary.scannedAt,
    items: index.summary.largestFiles.slice(0, DISK_INDEX_MAX_LARGEST_ITEMS).map((file) => ({
      path: `${diskIndexNodePath(index, file.dir).replace(/\/$/, '')}/${file.name}`,
      bytes: file.bytes,
      files: null,
      mtimeMs: file.mtimeMs
    }))
  }
}

/** Folders ranked by what sits directly inside them, which is where the space actually is. */
export function largestDiskIndexFolders(index: DiskIndex): MachineDiskIndexLargest {
  let top: number[] = []
  let floor = 0
  const trim = (): void => {
    top.sort((a, b) => index.ownBytes[b] - index.ownBytes[a])
    if (top.length > DISK_INDEX_MAX_LARGEST_ITEMS) {
      top = top.slice(0, DISK_INDEX_MAX_LARGEST_ITEMS)
      floor = index.ownBytes[top.at(-1)!]
    }
  }
  for (let node = 0; node < index.summary.nodeCount; node++) {
    if (index.ownBytes[node] > floor) {
      top.push(node)
      if (top.length >= DISK_INDEX_MAX_LARGEST_ITEMS * 4) {
        trim()
      }
    }
  }
  trim()
  return {
    kind: 'folders',
    scannedAt: index.summary.scannedAt,
    items: top.map((node) => ({
      path: diskIndexNodePath(index, node),
      bytes: Math.round(index.ownBytes[node]),
      files: index.ownFiles[node],
      mtimeMs: index.mtimeMs[node]
    }))
  }
}
