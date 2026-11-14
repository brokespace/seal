import { mkdir, open } from 'node:fs/promises'
import path from 'node:path'
import type {
  MachineFileEntry,
  MachineId,
  MachineMetrics
} from '../../../shared/machines/machine-types'
import {
  MACHINE_HOST_LIST_PAGE_MAX,
  MACHINE_HOST_READ_CHUNK_MAX_BYTES,
  MACHINE_HOST_WRITE_CHUNK_MAX_BYTES
} from '../../../shared/machines/machine-host-limits'
import {
  parseMachineHostChunk,
  parseMachineHostDirPage,
  parseMachineHostStat,
  parseMachineMetrics
} from '../../../shared/machines/machine-host-wire'
import {
  isAllowedDownloadUrl,
  type MachineFileStat,
  type MachineFileSystem,
  type MachineTransferProgress,
  type MachineTransferSession
} from '../filesystem/machine-filesystem'
import { forEachChunk } from './runtime-machine-chunk-pipeline'
import { RUNTIME_OUTDATED_MESSAGE, type RuntimeMachineChannel } from './runtime-machine-channel'
import { runRuntimeMachineUrlDownload, startRuntimeMachineWatch } from './runtime-machine-streams'

const CALL_TIMEOUT_MS = 30_000
const REMOVE_TIMEOUT_MS = 10 * 60 * 1000

function homePath(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'path' in value) {
    const { path: home } = value
    if (typeof home === 'string' && home) {
      return home
    }
  }
  throw new Error('Runtime returned an invalid home folder')
}

/** A paired Seal runtime's whole disk, over its RPC socket; transfers move in pipelined base64 slices. */
export class RuntimeMachineFileSystem implements MachineFileSystem {
  private home: Promise<string> | null = null
  private watchUnsupported = false

  constructor(
    readonly machineId: MachineId,
    private readonly channel: RuntimeMachineChannel
  ) {}

  private call(method: string, params: unknown = undefined, timeoutMs = CALL_TIMEOUT_MS) {
    return this.channel.call(method, params, timeoutMs)
  }

  async metrics(): Promise<MachineMetrics> {
    return parseMachineMetrics(await this.call('machineHost.metrics'), Date.now())
  }

  homeDir(): Promise<string> {
    this.home ??= this.call('machineHost.homeDir').then(homePath)
    this.home.catch(() => {
      this.home = null
    })
    return this.home
  }

  async listDir(dir: string): Promise<MachineFileEntry[]> {
    const entries: MachineFileEntry[] = []
    let total = Infinity
    while (entries.length < total) {
      const page = parseMachineHostDirPage(
        await this.call('machineHost.listDir', {
          path: dir,
          offset: entries.length,
          limit: MACHINE_HOST_LIST_PAGE_MAX
        })
      )
      total = page.total
      if (page.entries.length === 0) {
        break
      }
      entries.push(...page.entries)
    }
    return entries
  }

  async stat(target: string): Promise<MachineFileStat> {
    return parseMachineHostStat(await this.call('machineHost.stat', { path: target }))
  }

  private async readChunk(target: string, offset: number, length: number) {
    const chunk = parseMachineHostChunk(
      await this.call('machineHost.readChunk', { path: target, offset, length })
    )
    return { size: chunk.size, data: Buffer.from(chunk.contentBase64, 'base64') }
  }

  async readFile(target: string, maxBytes: number) {
    const first = await this.readChunk(
      target,
      0,
      Math.max(1, Math.min(maxBytes, MACHINE_HOST_READ_CHUNK_MAX_BYTES))
    )
    const wanted = Math.min(first.size, maxBytes)
    if (first.data.length >= wanted) {
      return { size: first.size, data: first.data.subarray(0, wanted) }
    }
    const data = Buffer.alloc(wanted)
    first.data.copy(data)
    await forEachChunk(
      wanted - first.data.length,
      MACHINE_HOST_READ_CHUNK_MAX_BYTES,
      async (offset, length) => {
        const at = first.data.length + offset
        const chunk = await this.readChunk(target, at, length)
        chunk.data.copy(data, at)
      }
    )
    return { size: first.size, data }
  }

  async writeFile(target: string, data: Buffer): Promise<void> {
    await this.writeSlices(target, data.length, async (offset, length) =>
      data.subarray(offset, offset + length)
    )
  }

  /** The first slice creates or truncates; later slices land by offset, so they can overlap in flight. */
  private async writeSlices(
    target: string,
    size: number,
    readSlice: (offset: number, length: number) => Promise<Buffer>,
    onProgress?: MachineTransferProgress,
    signal?: AbortSignal
  ): Promise<void> {
    signal?.throwIfAborted()
    const firstLength = Math.min(size, MACHINE_HOST_WRITE_CHUNK_MAX_BYTES)
    const first = await readSlice(0, firstLength)
    await this.call('machineHost.createFile', {
      path: target,
      contentBase64: first.toString('base64')
    })
    onProgress?.(first.length)
    await forEachChunk(
      size - firstLength,
      MACHINE_HOST_WRITE_CHUNK_MAX_BYTES,
      async (offset, length) => {
        const at = firstLength + offset
        const slice = await readSlice(at, length)
        await this.call('machineHost.writeChunk', {
          path: target,
          offset: at,
          contentBase64: slice.toString('base64')
        })
        onProgress?.(slice.length)
      },
      { signal }
    )
  }

  async createDir(target: string): Promise<void> {
    await this.call('machineHost.createDir', { path: target })
  }

  async rename(from: string, to: string): Promise<void> {
    await this.call('machineHost.rename', { from, to })
  }

  async remove(target: string): Promise<void> {
    await this.call('machineHost.remove', { path: target }, REMOVE_TIMEOUT_MS)
  }

  async openTransferSession(signal: AbortSignal): Promise<MachineTransferSession> {
    return {
      uploadFile: async (localPath, remotePath, _size, onProgress) => {
        const handle = await open(localPath, 'r')
        try {
          const { size } = await handle.stat()
          await this.writeSlices(
            remotePath,
            size,
            async (offset, length) => {
              const buffer = Buffer.alloc(length)
              const { bytesRead } = await handle.read(buffer, 0, length, offset)
              if (bytesRead !== length) {
                throw new Error(`File changed during upload: '${path.basename(localPath)}'`)
              }
              return buffer
            },
            onProgress,
            signal
          )
        } finally {
          await handle.close()
        }
      },
      downloadFile: async (remotePath, localPath, _size, onProgress) => {
        const { size } = await this.stat(remotePath)
        await mkdir(path.dirname(localPath), { recursive: true })
        const handle = await open(localPath, 'w')
        try {
          await forEachChunk(
            size,
            MACHINE_HOST_READ_CHUNK_MAX_BYTES,
            async (offset, length) => {
              const chunk = await this.readChunk(remotePath, offset, length)
              await handle.write(chunk.data, 0, chunk.data.length, offset)
              onProgress(chunk.data.length)
            },
            { signal }
          )
        } finally {
          await handle.close()
        }
      },
      close: () => {}
    }
  }

  async downloadUrl(
    url: string,
    destination: string,
    onProgress: (transferred: number, total: number | null) => void,
    signal: AbortSignal
  ): Promise<void> {
    if (!isAllowedDownloadUrl(url)) {
      throw new Error('Only http and https URLs can be downloaded')
    }
    await runRuntimeMachineUrlDownload(this.channel, url, destination, onProgress, signal)
  }

  async watch(dirs: string[], onChange: (dir: string) => void): Promise<(() => void) | null> {
    if (dirs.length === 0) {
      return () => {}
    }
    if (this.watchUnsupported) {
      return null
    }
    try {
      return await startRuntimeMachineWatch(this.channel, dirs, onChange)
    } catch (error) {
      if (error instanceof Error && error.message === RUNTIME_OUTDATED_MESSAGE) {
        this.watchUnsupported = true
      }
      return null
    }
  }
}
