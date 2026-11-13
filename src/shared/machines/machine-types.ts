import type { ExecutionHostId } from '../execution-host'

/** Machines are execution hosts: `local`, `ssh:<targetId>` or `runtime:<environmentId>`. */
export type MachineId = ExecutionHostId

export type MachineOs = 'linux' | 'darwin' | 'win32'

export type MachineMetrics = {
  hostname: string | null
  os: MachineOs | null
  /** Kernel or product version, e.g. `6.8.0-45-generic` or `14.5`. */
  osRelease: string | null
  arch: string | null
  cpuCount: number | null
  cpuModel: string | null
  /** 1/5/15 minute load averages; null on hosts that do not report them. */
  loadAverage: [number, number, number] | null
  /** Instant CPU busy percentage, for hosts (Windows) that report no load average. */
  cpuUsagePercent: number | null
  memTotalBytes: number | null
  memAvailableBytes: number | null
  diskTotalBytes: number | null
  diskAvailableBytes: number | null
  /** Mount the disk numbers describe (the home directory's filesystem). */
  diskMount: string | null
  uptimeSeconds: number | null
  homeDir: string | null
  collectedAt: number
}

export type MachineFileKind = 'file' | 'directory' | 'symlink' | 'other'

export type MachineFileEntry = {
  name: string
  kind: MachineFileKind
  /** Symlinks that resolve to a directory are browsable like one. */
  isDirectoryLike: boolean
  size: number
  mtimeMs: number
}

export type MachineDirListing = {
  machineId: MachineId
  path: string
  entries: MachineFileEntry[]
  /** Large folders are capped; the rest load on demand via `offset`. */
  totalEntries: number
  offset: number
  listedAt: number
  fromCache: boolean
}

export type MachineFileRead = {
  path: string
  size: number
  /** Base64 of the first `maxBytes` bytes. */
  contentBase64: string
  truncated: boolean
}

export type MachineTransferDirection = 'upload' | 'download' | 'url-download'

export type MachineTransferStatus = 'running' | 'done' | 'failed' | 'cancelled'

export type MachineTransfer = {
  id: string
  machineId: MachineId
  direction: MachineTransferDirection
  label: string
  /** Remote folder for uploads/URL downloads, local folder for downloads. */
  destination: string
  /** Null until the size is known (URL downloads without Content-Length). */
  totalBytes: number | null
  transferredBytes: number
  filesTotal: number
  filesDone: number
  status: MachineTransferStatus
  error: string | null
  startedAt: number
  finishedAt: number | null
}

export type MachineDirChangedEvent = {
  machineId: MachineId
  path: string
}

export const MACHINE_IPC = {
  getMetrics: 'machines:getMetrics',
  listDir: 'machines:listDir',
  watchDirs: 'machines:watchDirs',
  readFile: 'machines:readFile',
  writeFile: 'machines:writeFile',
  createDir: 'machines:createDir',
  rename: 'machines:rename',
  remove: 'machines:remove',
  upload: 'machines:upload',
  download: 'machines:download',
  downloadUrl: 'machines:downloadUrl',
  cancelTransfer: 'machines:cancelTransfer',
  listTransfers: 'machines:listTransfers',
  clearFinishedTransfers: 'machines:clearFinishedTransfers',
  startDrag: 'machines:startDrag',
  transferUpdated: 'machines:transferUpdated',
  dirChanged: 'machines:dirChanged'
} as const

/** Entries returned per listing page; folders past this load lazily. */
export const MACHINE_DIR_PAGE_SIZE = 2000

/** Previews read at most this much; larger text files open truncated. */
export const MACHINE_PREVIEW_MAX_BYTES = 16 * 1024 * 1024
