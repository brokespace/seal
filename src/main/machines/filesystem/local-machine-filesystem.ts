import { createReadStream, createWriteStream, watch, type FSWatcher } from 'node:fs'
import { lstat, mkdir, open, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { LOCAL_EXECUTION_HOST_ID } from '../../../shared/execution-host'
import type { MachineFileEntry } from '../../../shared/machines/machine-types'
import type {
  MachineFileStat,
  MachineFileSystem,
  MachineTransferProgress,
  MachineTransferSession
} from './machine-filesystem'

const LSTAT_CONCURRENCY = 64

async function entryFor(dir: string, name: string): Promise<MachineFileEntry> {
  const full = path.join(dir, name)
  const info = await lstat(full)
  const kind = info.isDirectory()
    ? 'directory'
    : info.isSymbolicLink()
      ? 'symlink'
      : info.isFile()
        ? 'file'
        : 'other'
  const isDirectoryLike =
    kind === 'directory' ||
    (kind === 'symlink' &&
      (await stat(full)
        .then((s) => s.isDirectory())
        .catch(() => false)))
  return { name, kind, isDirectoryLike, size: info.size, mtimeMs: info.mtimeMs }
}

function progressStream(onProgress: MachineTransferProgress): Transform {
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      onProgress(chunk.length)
      callback(null, chunk)
    }
  })
}

async function copyWithProgress(
  from: string,
  to: string,
  onProgress: MachineTransferProgress,
  signal: AbortSignal
): Promise<void> {
  await mkdir(path.dirname(to), { recursive: true })
  await pipeline(createReadStream(from), progressStream(onProgress), createWriteStream(to), {
    signal
  })
}

async function* readBody(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        return
      }
      yield value
    }
  } finally {
    reader.releaseLock()
  }
}

export function createLocalMachineFileSystem(): MachineFileSystem {
  return {
    machineId: LOCAL_EXECUTION_HOST_ID,
    homeDir: async () => os.homedir(),
    async listDir(dir) {
      const names = await readdir(dir)
      const entries: MachineFileEntry[] = []
      for (let index = 0; index < names.length; index += LSTAT_CONCURRENCY) {
        const batch = names.slice(index, index + LSTAT_CONCURRENCY)
        const settled = await Promise.allSettled(batch.map((name) => entryFor(dir, name)))
        for (const result of settled) {
          // Files that vanish mid-listing are simply skipped.
          if (result.status === 'fulfilled') {
            entries.push(result.value)
          }
        }
      }
      return entries
    },
    async stat(target): Promise<MachineFileStat> {
      const entry = await entryFor(path.dirname(target), path.basename(target))
      return { ...entry, path: target }
    },
    async readFile(target, maxBytes) {
      const handle = await open(target, 'r')
      try {
        const { size } = await handle.stat()
        const length = Math.min(size, maxBytes)
        const data = Buffer.alloc(length)
        let offset = 0
        while (offset < length) {
          const { bytesRead } = await handle.read(data, offset, length - offset, offset)
          if (bytesRead === 0) {
            break
          }
          offset += bytesRead
        }
        return { size, data: data.subarray(0, offset) }
      } finally {
        await handle.close()
      }
    },
    writeFile: (target, data) => writeFile(target, data),
    createDir: async (target) => {
      await mkdir(target, { recursive: true })
    },
    async rename(from, to) {
      if (
        await lstat(to).then(
          () => true,
          () => false
        )
      ) {
        throw new Error('Destination already exists')
      }
      await rename(from, to)
    },
    remove: (target) => rm(target, { recursive: true, force: true }),
    async openTransferSession(signal): Promise<MachineTransferSession> {
      return {
        uploadFile: (localPath, remotePath, _size, onProgress) =>
          copyWithProgress(localPath, remotePath, onProgress, signal),
        downloadFile: (remotePath, localPath, _size, onProgress) =>
          copyWithProgress(remotePath, localPath, onProgress, signal),
        close: () => {}
      }
    },
    async downloadUrl(url, destination, onProgress, signal) {
      const response = await fetch(url, { signal, redirect: 'follow' })
      if (!response.ok || !response.body) {
        throw new Error(`Download failed: HTTP ${response.status}`)
      }
      const totalHeader = Number(response.headers.get('content-length'))
      const total = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : null
      let transferred = 0
      await mkdir(path.dirname(destination), { recursive: true })
      await pipeline(
        Readable.from(readBody(response.body)),
        progressStream((delta) => {
          transferred += delta
          onProgress(transferred, total)
        }),
        createWriteStream(destination),
        { signal }
      )
    },
    async watch(dirs, onChange) {
      const watchers: FSWatcher[] = []
      for (const dir of dirs) {
        try {
          const watcher = watch(dir, { persistent: false }, () => onChange(dir))
          watcher.on('error', () => watcher.close())
          watchers.push(watcher)
        } catch {
          // Unwatchable folders (permissions, network mounts) fall back to polling upstream.
        }
      }
      return () => {
        for (const watcher of watchers) {
          watcher.close()
        }
      }
    }
  }
}
