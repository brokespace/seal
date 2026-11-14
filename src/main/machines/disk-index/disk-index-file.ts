import { createHash } from 'node:crypto'
import { mkdir, open, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  DISK_INDEX_PREAMBLE_BYTES,
  diskIndexHeaderBytes,
  encodeDiskIndex,
  parseDiskIndexSummary,
  viewDiskIndex,
  type DiskIndex,
  type DiskIndexArrays,
  type DiskIndexSummary
} from './disk-index-layout'

const READ_CHUNK_BYTES = 256 * 1024 * 1024

export function diskIndexFilePath(dataDir: string, root: string): string {
  const id = createHash('sha256').update(root).digest('hex').slice(0, 16)
  return join(dataDir, `index-${id}.bin`)
}

/** Only the header of a stored index, without loading its arrays. */
export async function readDiskIndexSummary(path: string): Promise<DiskIndexSummary | null> {
  const handle = await open(path, 'r').catch(() => null)
  if (!handle) {
    return null
  }
  try {
    const preamble = new Uint8Array(DISK_INDEX_PREAMBLE_BYTES)
    await handle.read(preamble, 0, preamble.byteLength, 0)
    const headerBytes = diskIndexHeaderBytes(preamble)
    if (headerBytes === null || headerBytes > 64 * 1024 * 1024) {
      return null
    }
    const header = new Uint8Array(headerBytes)
    const { bytesRead } = await handle.read(header, 0, headerBytes, DISK_INDEX_PREAMBLE_BYTES)
    return bytesRead === headerBytes ? parseDiskIndexSummary(header) : null
  } catch {
    return null
  } finally {
    await handle.close()
  }
}

/** Loads a stored index. `shared` puts it in memory every walker thread can read without a copy. */
export async function readDiskIndex(path: string, shared: boolean): Promise<DiskIndex | null> {
  const handle = await open(path, 'r').catch(() => null)
  if (!handle) {
    return null
  }
  try {
    const { size } = await handle.stat()
    const buffer = shared ? new SharedArrayBuffer(size) : new ArrayBuffer(size)
    const bytes = new Uint8Array(buffer)
    let position = 0
    while (position < size) {
      const { bytesRead } = await handle.read(
        bytes,
        position,
        Math.min(READ_CHUNK_BYTES, size - position),
        position
      )
      if (bytesRead === 0) {
        return null
      }
      position += bytesRead
    }
    return viewDiskIndex(buffer)
  } catch {
    return null
  } finally {
    await handle.close()
  }
}

/** Replaces the stored index in one rename, so a reader never sees half of one. */
export async function writeDiskIndex(
  path: string,
  summary: DiskIndexSummary,
  arrays: DiskIndexArrays
): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.tmp`
  const handle = await open(temporary, 'w', 0o600)
  try {
    for (const chunk of encodeDiskIndex(summary, arrays)) {
      let offset = 0
      while (offset < chunk.byteLength) {
        const { bytesWritten } = await handle.write(chunk, offset, chunk.byteLength - offset)
        offset += bytesWritten
      }
    }
  } catch (error) {
    await handle.close()
    await rm(temporary, { force: true })
    throw error
  }
  await handle.close()
  await rename(temporary, path)
}
