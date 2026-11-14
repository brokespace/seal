import type { MachineFileEntry, MachineId } from '../../../shared/machines/machine-types'

/** Bytes moved since the previous call. */
export type MachineTransferProgress = (deltaBytes: number) => void

export type MachineFileStat = MachineFileEntry & { path: string }

/** One transfer job's channel; closing it aborts whatever it is moving. */
export type MachineTransferSession = {
  uploadFile(
    localPath: string,
    remotePath: string,
    size: number,
    onProgress: MachineTransferProgress
  ): Promise<void>
  downloadFile(
    remotePath: string,
    localPath: string,
    size: number,
    onProgress: MachineTransferProgress
  ): Promise<void>
  close(): void
}

export type MachineFileSystem = {
  readonly machineId: MachineId
  homeDir(): Promise<string>
  listDir(path: string): Promise<MachineFileEntry[]>
  stat(path: string): Promise<MachineFileStat>
  readFile(path: string, maxBytes: number): Promise<{ size: number; data: Buffer }>
  writeFile(path: string, data: Buffer): Promise<void>
  /** `mkdir -p` semantics. */
  createDir(path: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  /** Recursive for folders. */
  remove(path: string): Promise<void>
  openTransferSession(signal: AbortSignal): Promise<MachineTransferSession>
  downloadUrl(
    url: string,
    destinationPath: string,
    onProgress: (transferredBytes: number, totalBytes: number | null) => void,
    signal: AbortSignal
  ): Promise<void>
  /** Native change feed for `dirs`; null when the machine has none, so callers poll. */
  watch(dirs: string[], onChange: (dir: string) => void): Promise<(() => void) | null>
}

export function isAllowedDownloadUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/** Derives a file name from a URL path, falling back to `download`. */
export function fileNameFromUrl(url: string): string {
  try {
    const segment = new URL(url).pathname.split('/').findLast(Boolean)
    const decoded = segment ? decodeURIComponent(segment) : ''
    return decoded && !/[\\/\0]/.test(decoded) && decoded !== '..' ? decoded : 'download'
  } catch {
    return 'download'
  }
}
