import { mkdir, open, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { MachineFileEntry } from '../../../../../shared/machines/machine-types'
import type {
  MachineHostChunk,
  MachineHostDirPage
} from '../../../../../shared/machines/machine-host-wire'
import { createLocalMachineFileSystem } from '../../../../machines/filesystem/local-machine-filesystem'

/** The runtime host serves its own disk; the desktop's machine layer drives it over RPC. */
export const machineHostFileSystem = createLocalMachineFileSystem()

const PAGE_CACHE_TTL_MS = 15_000
const PAGE_CACHE_MAX_DIRS = 16

type CachedListing = { entries: MachineFileEntry[]; listedAt: number }

const listingCache = new Map<string, CachedListing>()

export function requireHostPath(target: string): string {
  if (!path.isAbsolute(target)) {
    throw new Error('Machine paths must be absolute')
  }
  return path.resolve(target)
}

function isFilesystemRoot(target: string): boolean {
  return path.parse(target).root === target
}

/** Page 0 always relists; later pages slice that snapshot so offsets stay consistent. */
export async function listHostDirPage(
  dir: string,
  offset: number,
  limit: number,
  now = Date.now()
): Promise<MachineHostDirPage> {
  const target = requireHostPath(dir)
  let cached = listingCache.get(target)
  if (offset === 0 || !cached || now - cached.listedAt > PAGE_CACHE_TTL_MS) {
    const entries = await machineHostFileSystem.listDir(target)
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    cached = { entries, listedAt: now }
    listingCache.delete(target)
    listingCache.set(target, cached)
    for (const key of listingCache.keys()) {
      if (listingCache.size <= PAGE_CACHE_MAX_DIRS) {
        break
      }
      listingCache.delete(key)
    }
  }
  return { entries: cached.entries.slice(offset, offset + limit), total: cached.entries.length }
}

export async function readHostChunk(
  target: string,
  offset: number,
  length: number
): Promise<MachineHostChunk> {
  const handle = await open(requireHostPath(target), 'r')
  try {
    const { size } = await handle.stat()
    const wanted = Math.max(0, Math.min(length, size - offset))
    const buffer = Buffer.alloc(wanted)
    let read = 0
    while (read < wanted) {
      const { bytesRead } = await handle.read(buffer, read, wanted - read, offset + read)
      if (bytesRead === 0) {
        break
      }
      read += bytesRead
    }
    return { size, contentBase64: buffer.subarray(0, read).toString('base64') }
  } finally {
    await handle.close()
  }
}

export async function createHostFile(target: string, contentBase64: string): Promise<void> {
  const resolved = requireHostPath(target)
  await mkdir(path.dirname(resolved), { recursive: true })
  await writeFile(resolved, Buffer.from(contentBase64, 'base64'))
}

/** Positional, so the desktop can keep several slices in flight. */
export async function writeHostChunk(
  target: string,
  offset: number,
  contentBase64: string
): Promise<void> {
  const data = Buffer.from(contentBase64, 'base64')
  const handle = await open(requireHostPath(target), 'r+')
  try {
    let written = 0
    while (written < data.length) {
      const { bytesWritten } = await handle.write(
        data,
        written,
        data.length - written,
        offset + written
      )
      written += bytesWritten
    }
  } finally {
    await handle.close()
  }
}

export async function removeHostPath(target: string): Promise<void> {
  const resolved = requireHostPath(target)
  if (isFilesystemRoot(resolved)) {
    throw new Error('Refusing to delete a filesystem root')
  }
  await machineHostFileSystem.remove(resolved)
}
