/** `local`, or `machine:<record id>` whichever transport the machine uses. */
export type MachineId = 'local' | `machine:${string}`

export const LOCAL_MACHINE_ID = 'local'

export function toMachineId(recordId: string): MachineId {
  return `machine:${recordId}`
}

/** The record id behind a machine id, or null for this computer and unknown spellings. */
export function machineRecordId(id: string): string | null {
  return id.startsWith('machine:') && id.length > 'machine:'.length
    ? id.slice('machine:'.length)
    : null
}

export function parseMachineId(value: unknown): MachineId | null {
  if (value === LOCAL_MACHINE_ID) {
    return LOCAL_MACHINE_ID
  }
  const recordId = typeof value === 'string' ? machineRecordId(value) : null
  return recordId ? toMachineId(recordId) : null
}

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
  dirChanged: 'machines:dirChanged',
  list: 'machines:list',
  changed: 'machines:changed',
  setConnection: 'machines:setConnection',
  renameMachine: 'machines:renameMachine',
  adopt: 'machines:adopt',
  separate: 'machines:separate',
  connect: 'machines:connect',
  shellOpen: 'machines:shellOpen',
  shellWrite: 'machines:shellWrite',
  shellResize: 'machines:shellResize',
  shellClose: 'machines:shellClose',
  shellEvent: 'machines:shellEvent',
  detectCommands: 'machines:detectCommands',
  listWorktrees: 'machines:listWorktrees',
  createWorktree: 'machines:createWorktree',
  removeWorktree: 'machines:removeWorktree',
  listProcesses: 'machines:listProcesses',
  signalProcess: 'machines:signalProcess',
  listDockerContainers: 'machines:listDockerContainers',
  dockerContainerAction: 'machines:dockerContainerAction',
  listDiskMounts: 'machines:listDiskMounts',
  measureDiskUsage: 'machines:measureDiskUsage',
  scanCleanup: 'machines:scanCleanup',
  runCleanup: 'machines:runCleanup',
  completeFolder: 'machines:completeFolder',
  openFolder: 'machines:openFolder',
  recentFolders: 'machines:recentFolders'
} as const

export type MachineShellEvent =
  | { sessionId: string; kind: 'data'; data: string }
  | { sessionId: string; kind: 'exit'; exitCode: number | null }

export type MachineShellOpenResult =
  | { ok: true; sessionId: string; transport: 'local' | 'ssh' | 'server' }
  | { ok: false; message: string }

/** Entries returned per listing page; folders past this load lazily. */
export const MACHINE_DIR_PAGE_SIZE = 2000

/** Previews read at most this much; larger text files open truncated. */
export const MACHINE_PREVIEW_MAX_BYTES = 16 * 1024 * 1024
