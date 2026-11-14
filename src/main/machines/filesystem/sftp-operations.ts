import type { FileEntryWithStats, SFTPWrapper, Stats, TransferOptions } from 'ssh2'
import type { MachineFileEntry, MachineFileKind } from '../../../shared/machines/machine-types'
import type { MachineTransferProgress } from './machine-filesystem'

const READ_CHUNK_BYTES = 32 * 1024
const READ_CONCURRENCY = 64
export const SFTP_TRANSFER_OPTIONS: Pick<TransferOptions, 'concurrency' | 'chunkSize'> = {
  concurrency: 64,
  chunkSize: 32 * 1024
}

function callback<T>(register: (cb: (err: Error | undefined | null, value: T) => void) => void) {
  return new Promise<T>((resolve, reject) => {
    register((err, value) => (err ? reject(err) : resolve(value)))
  })
}

function callbackVoid(register: (cb: (err: Error | undefined | null) => void) => void) {
  return new Promise<void>((resolve, reject) => {
    register((err) => (err ? reject(err) : resolve()))
  })
}

function sftpErrorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
}

/** SFTP status errors carry a numeric code; anything else means the channel itself broke. */
export function isSftpStatusError(error: unknown): boolean {
  return typeof sftpErrorCode(error) === 'number'
}

export function isSftpNoSuchFile(error: unknown): boolean {
  return sftpErrorCode(error) === 2
}

function kindOf(attrs: Stats): MachineFileKind {
  if (attrs.isDirectory()) {
    return 'directory'
  }
  if (attrs.isSymbolicLink()) {
    return 'symlink'
  }
  return attrs.isFile() ? 'file' : 'other'
}

export function sftpEntry(name: string, attrs: Stats): MachineFileEntry {
  const kind = kindOf(attrs)
  return {
    name,
    kind,
    isDirectoryLike: kind === 'directory',
    size: attrs.size ?? 0,
    mtimeMs: (attrs.mtime ?? 0) * 1000
  }
}

export function sftpJoin(dir: string, name: string): string {
  return dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`
}

export const sftpStat = (sftp: SFTPWrapper, path: string): Promise<Stats> =>
  callback((cb) => sftp.stat(path, cb))

export const sftpLstat = (sftp: SFTPWrapper, path: string): Promise<Stats> =>
  callback((cb) => sftp.lstat(path, cb))

export const sftpRealpath = (sftp: SFTPWrapper, path: string): Promise<string> =>
  callback((cb) => sftp.realpath(path, cb))

export const sftpUnlink = (sftp: SFTPWrapper, path: string): Promise<void> =>
  callbackVoid((cb) => sftp.unlink(path, cb))

/**
 * Replaces a file's bytes in place. ssh2's write stream sets every file it opens to mode 0666,
 * which would open a token file to every account; opening the file directly keeps its mode.
 */
export const sftpWriteFile = (sftp: SFTPWrapper, path: string, data: Buffer): Promise<void> =>
  callbackVoid((cb) => sftp.writeFile(path, data, cb))

export const sftpRename = (sftp: SFTPWrapper, from: string, to: string): Promise<void> =>
  callbackVoid((cb) => sftp.rename(from, to, cb))

export async function sftpListDir(sftp: SFTPWrapper, dir: string): Promise<MachineFileEntry[]> {
  const list = await callback<FileEntryWithStats[]>((cb) => sftp.readdir(dir, cb))
  const entries = list
    .filter((item) => item.filename !== '.' && item.filename !== '..')
    .map((item) => sftpEntry(item.filename, item.attrs))
  // readdir reports links themselves; only links need a follow-up stat to learn if they browse like folders.
  await Promise.all(
    entries
      .filter((entry) => entry.kind === 'symlink')
      .map(async (entry) => {
        entry.isDirectoryLike = await sftpStat(sftp, sftpJoin(dir, entry.name))
          .then((stats) => stats.isDirectory())
          .catch(() => false)
      })
  )
  return entries
}

export async function sftpMkdirP(sftp: SFTPWrapper, path: string): Promise<void> {
  const exists = await sftpStat(sftp, path).then(
    (stats) => stats.isDirectory(),
    () => false
  )
  if (exists) {
    return
  }
  const parent = path.replace(/\/+[^/]+\/*$/, '')
  if (parent && parent !== path) {
    await sftpMkdirP(sftp, parent)
  }
  await callbackVoid((cb) => sftp.mkdir(path, cb)).catch(async (error) => {
    // A concurrent upload may have created it between stat and mkdir.
    const created = await sftpStat(sftp, path).then(
      (stats) => stats.isDirectory(),
      () => false
    )
    if (!created) {
      throw error
    }
  })
}

/** Reads the first `length` bytes with pipelined requests so latency does not serialize the preview. */
export async function sftpReadHead(
  sftp: SFTPWrapper,
  path: string,
  maxBytes: number
): Promise<{ size: number; data: Buffer }> {
  const handle = await callback<Buffer>((cb) => sftp.open(path, 'r', cb))
  try {
    const stats = await callback<Stats>((cb) => sftp.fstat(handle, cb))
    const length = Math.min(stats.size ?? 0, maxBytes)
    const data = Buffer.alloc(length)
    const ranges: [number, number][] = []
    for (let pos = 0; pos < length; pos += READ_CHUNK_BYTES) {
      ranges.push([pos, Math.min(READ_CHUNK_BYTES, length - pos)])
    }
    let filled = 0
    await new Promise<void>((resolve, reject) => {
      let inflight = 0
      let failed = false
      const pump = (): void => {
        if (failed) {
          return
        }
        if (ranges.length === 0 && inflight === 0) {
          resolve()
          return
        }
        while (inflight < READ_CONCURRENCY && ranges.length > 0) {
          const [pos, len] = ranges.shift()!
          inflight += 1
          sftp.read(handle, data, pos, len, pos, (err, bytesRead) => {
            inflight -= 1
            if (err) {
              failed = true
              reject(err)
              return
            }
            filled = Math.max(filled, pos + bytesRead)
            // Servers may answer short; re-request the remainder unless the file ended.
            if (bytesRead > 0 && bytesRead < len) {
              ranges.push([pos + bytesRead, len - bytesRead])
            }
            pump()
          })
        }
      }
      pump()
    })
    return { size: stats.size ?? 0, data: data.subarray(0, Math.min(length, filled)) }
  } finally {
    await callbackVoid((cb) => sftp.close(handle, cb)).catch(() => {})
  }
}

function stepReporter(onProgress: MachineTransferProgress): TransferOptions['step'] {
  let last = 0
  return (total) => {
    onProgress(total - last)
    last = total
  }
}

export const sftpFastPut = (
  sftp: SFTPWrapper,
  localPath: string,
  remotePath: string,
  onProgress: MachineTransferProgress
): Promise<void> =>
  callbackVoid((cb) =>
    sftp.fastPut(
      localPath,
      remotePath,
      { ...SFTP_TRANSFER_OPTIONS, step: stepReporter(onProgress) },
      cb
    )
  )

export const sftpFastGet = (
  sftp: SFTPWrapper,
  remotePath: string,
  localPath: string,
  onProgress: MachineTransferProgress
): Promise<void> =>
  callbackVoid((cb) =>
    sftp.fastGet(
      remotePath,
      localPath,
      { ...SFTP_TRANSFER_OPTIONS, step: stepReporter(onProgress) },
      cb
    )
  )
