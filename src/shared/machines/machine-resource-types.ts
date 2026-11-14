import type { MachineId } from './machine-types'

export type MachineProcessAgent = 'claude' | 'codex'

export type MachineProcess = {
  pid: number
  ppid: number
  user: string
  name: string
  /** Command line with secret-looking values masked. */
  command: string
  /** Share of one core, so a busy multi-threaded process reads above 100. */
  cpuPercent: number
  memPercent: number
  rssBytes: number
  /** Start marker; a signal is refused once the pid belongs to a different process. */
  startMarker: string
  /** `session:window.pane` of the tmux pane this process runs under. */
  tmuxPane: string | null
  agent: MachineProcessAgent | null
  /** Stopping it would cut the connection Seal is using to reach this machine. */
  carriesSealConnection: boolean
}

export type MachineSwapUsage = { totalBytes: number; usedBytes: number }

/** Everything running under one tmux pane, added up. */
export type MachineTmuxPaneUsage = {
  /** `session:window.pane` */
  pane: string
  /** The pane's own process, usually a shell. */
  pid: number
  cpuPercent: number
  rssBytes: number
  processCount: number
}

export type MachineProcessSnapshot = {
  /** The busiest processes by CPU and by memory, plus agents and tmux pane shells; not every process. */
  processes: MachineProcess[]
  tmuxPanes: MachineTmuxPaneUsage[]
  totalProcesses: number
  /** Whole-machine busy share over the sample window; null where the host does not report it. */
  cpuBusyPercent: number | null
  /** Null when the host reports no swap figures. */
  swap: MachineSwapUsage | null
  collectedAt: number
}

export type MachineProcessSignal = 'TERM' | 'KILL'

export type MachineProcessSignalResult =
  | { outcome: 'sent' }
  /** The process had already exited. */
  | { outcome: 'gone' }
  /** The pid was reused by another process, so nothing was signalled. */
  | { outcome: 'replaced' }
  | { outcome: 'failed'; message: string }

export type MachineDockerContainer = {
  id: string
  name: string
  image: string
  status: string
  running: boolean
  memUsageBytes: number | null
  memLimitBytes: number | null
  memPercent: number | null
  cpuPercent: number | null
}

export type MachineDockerContainers =
  | { state: 'missing' }
  | { state: 'unreachable'; message: string }
  | { state: 'ready'; containers: MachineDockerContainer[] }

export type MachineDockerContainerAction = 'stop' | 'restart'

export type MachineDiskMount = {
  filesystem: string
  mount: string
  totalBytes: number
  usedBytes: number
  availableBytes: number
}

export type MachineDiskUsageEntry = {
  path: string
  name: string
  kind: 'directory' | 'file' | 'symlink'
  bytes: number
}

export type MachineDiskUsage = {
  path: string
  totalBytes: number
  /** Largest first; folders with more children list only the biggest. */
  entries: MachineDiskUsageEntry[]
  omittedCount: number
  omittedBytes: number
  /** Some children could not be read, so the totals are a lower bound. */
  incomplete: boolean
}

export const MACHINE_CLEANUP_TARGETS = [
  'docker-images',
  'docker-containers',
  'docker-volumes',
  'docker-build-cache',
  'package-caches',
  'node-modules',
  'trash',
  'old-logs',
  'seal-caches'
] as const

export type MachineCleanupTargetId = (typeof MACHINE_CLEANUP_TARGETS)[number]

export type MachineCleanupItem = {
  id: string
  /** What is removed: a path, or a Docker object name. */
  label: string
  /** Which tool or group it belongs to, e.g. `npm`. */
  group: string | null
  bytes: number | null
  modifiedAt: number | null
  /** Ticked when the confirmation opens; risky items start unticked. */
  preselected: boolean
}

export type MachineCleanupScan = {
  machineId: MachineId
  target: MachineCleanupTargetId
  /** Names this scan; a cleanup removes only items listed under it. */
  token: string
  items: MachineCleanupItem[]
  totalBytes: number
  /** Matches left out of `items` because the list is capped to the largest. */
  omittedCount: number
  /** Why nothing can be listed (Docker missing, daemon unreachable). */
  unavailable: string | null
}

export type MachineCleanupResult = {
  removedIds: string[]
  freedBytes: number
  failures: { id: string; label: string; message: string }[]
}

export type MachineFolderCompletion = {
  /** The folder whose children were matched, absolute. */
  parent: string
  matches: { name: string; path: string }[]
  /** More folders matched than were returned. */
  truncated: boolean
}

export type MachineFolderOpenResult = { ok: true; path: string } | { ok: false; message: string }
