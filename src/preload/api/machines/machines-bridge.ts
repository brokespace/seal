import { ipcRenderer } from 'electron'
import {
  MACHINE_IPC,
  type MachineDirChangedEvent,
  type MachineDirListing,
  type MachineFileRead,
  type MachineId,
  type MachineMetrics,
  type MachineShellEvent,
  type MachineShellOpenResult,
  type MachineTransfer
} from '../../../shared/machines/machine-types'
import type { MachineConnectionType } from '../../../shared/machines/machine-record'
import type { MachineView, MachineWorktree } from '../../../shared/machines/machine-view'
import type {
  MachineCleanupResult,
  MachineCleanupScan,
  MachineCleanupTargetId,
  MachineDiskMount,
  MachineDiskUsage,
  MachineDockerContainerAction,
  MachineDockerContainers,
  MachineFolderCompletion,
  MachineFolderOpenResult,
  MachineProcessSignal,
  MachineProcessSignalResult,
  MachineProcessSnapshot
} from '../../../shared/machines/machine-resource-types'

export type MachinesApi = {
  getMetrics: (args: { machineId: MachineId }) => Promise<MachineMetrics>
  /** Omitting `path` lists the machine's home folder. */
  listDir: (args: {
    machineId: MachineId
    path?: string
    force?: boolean
    offset?: number
  }) => Promise<MachineDirListing>
  watchDirs: (args: { machineId: MachineId; dirs: string[] }) => Promise<void>
  readFile: (args: {
    machineId: MachineId
    path: string
    maxBytes?: number
  }) => Promise<MachineFileRead>
  writeFile: (args: { machineId: MachineId; path: string; content: string }) => Promise<void>
  createDir: (args: { machineId: MachineId; path: string }) => Promise<void>
  rename: (args: { machineId: MachineId; from: string; to: string }) => Promise<void>
  remove: (args: { machineId: MachineId; paths: string[] }) => Promise<void>
  upload: (args: {
    machineId: MachineId
    localPaths: string[]
    destDir: string
  }) => Promise<MachineTransfer>
  /** Asks for a local folder first; null when the user cancels. */
  download: (args: { machineId: MachineId; paths: string[] }) => Promise<MachineTransfer | null>
  downloadUrl: (args: {
    machineId: MachineId
    url: string
    destDir: string
    fileName?: string
  }) => Promise<MachineTransfer>
  cancelTransfer: (args: { transferId: string }) => Promise<void>
  listTransfers: () => Promise<MachineTransfer[]>
  clearFinishedTransfers: () => Promise<void>
  /** `prepare` stages a remote file locally so the real drag can start immediately. */
  startDrag: (args: { machineId: MachineId; path: string; size: number; prepare?: boolean }) => void
  onTransferUpdated: (callback: (transfer: MachineTransfer) => void) => () => void
  onDirChanged: (callback: (event: MachineDirChangedEvent) => void) => () => void
  list: () => Promise<MachineView[]>
  onChanged: (callback: () => void) => () => void
  /** Switches the transport; the other transport's details stay stored. */
  setConnection: (args: {
    machineId: MachineId
    connection: MachineConnectionType
  }) => Promise<MachineView>
  renameMachine: (args: { machineId: MachineId; name: string }) => Promise<MachineView>
  /** Binds just-saved SSH details or a paired server to a new or existing machine. */
  adopt: (args: {
    sshTargetId?: string
    environmentId?: string
    connection: MachineConnectionType
    name?: string
    machineId?: MachineId
  }) => Promise<MachineView>
  separate: (args: { machineId: MachineId }) => Promise<MachineView[]>
  connect: (args: { machineId: MachineId }) => Promise<void>
  /** `agent` starts that agent (with `prompt`) instead of a plain shell. */
  shellOpen: (args: {
    machineId: MachineId
    cols: number
    rows: number
    cwd?: string
    command?: string
    agent?: string
    prompt?: string
  }) => Promise<MachineShellOpenResult>
  shellWrite: (args: { sessionId: string; data: string }) => Promise<void>
  shellResize: (args: { sessionId: string; cols: number; rows: number }) => Promise<void>
  shellClose: (args: { sessionId: string }) => Promise<void>
  onShellEvent: (callback: (event: MachineShellEvent) => void) => () => void
  /** The subset of `commands` found on the machine's PATH. */
  detectCommands: (args: { machineId: MachineId; commands: string[] }) => Promise<string[]>
  listWorktrees: (args: { machineId: MachineId; repoPath: string }) => Promise<MachineWorktree[]>
  createWorktree: (args: {
    machineId: MachineId
    repoPath: string
    path: string
    branch: string
    base?: string
  }) => Promise<MachineWorktree[]>
  removeWorktree: (args: {
    machineId: MachineId
    repoPath: string
    path: string
    force?: boolean
    unlock?: boolean
  }) => Promise<MachineWorktree[]>
  /** The busiest processes by CPU and memory; Linux and macOS machines only. */
  listProcesses: (args: { machineId: MachineId }) => Promise<MachineProcessSnapshot>
  signalProcess: (args: {
    machineId: MachineId
    pid: number
    signal: MachineProcessSignal
    startMarker: string
  }) => Promise<MachineProcessSignalResult>
  listDockerContainers: (args: { machineId: MachineId }) => Promise<MachineDockerContainers>
  dockerContainerAction: (args: {
    machineId: MachineId
    containerId: string
    action: MachineDockerContainerAction
  }) => Promise<void>
  listDiskMounts: (args: { machineId: MachineId }) => Promise<MachineDiskMount[]>
  /** Sizes of what sits directly under `path`; a newer call for the machine cancels this one. */
  measureDiskUsage: (args: { machineId: MachineId; path: string }) => Promise<MachineDiskUsage>
  scanCleanup: (args: {
    machineId: MachineId
    target: MachineCleanupTargetId
  }) => Promise<MachineCleanupScan>
  /** Removes only `itemIds` of the scan `token` names. */
  runCleanup: (args: {
    machineId: MachineId
    token: string
    itemIds: string[]
  }) => Promise<MachineCleanupResult>
  /** Folders matching a typed path; `~` and paths relative to `currentDir` are expanded. */
  completeFolder: (args: {
    machineId: MachineId
    input: string
    currentDir?: string
  }) => Promise<MachineFolderCompletion>
  /** Checks the typed path is a folder and remembers it in the machine's recent folders. */
  openFolder: (args: {
    machineId: MachineId
    input: string
    currentDir?: string
  }) => Promise<MachineFolderOpenResult>
  recentFolders: (args: { machineId: MachineId }) => Promise<string[]>
}

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

export const machinesApi: MachinesApi = {
  getMetrics: (args) => ipcRenderer.invoke(MACHINE_IPC.getMetrics, args),
  listDir: (args) => ipcRenderer.invoke(MACHINE_IPC.listDir, args),
  watchDirs: (args) => ipcRenderer.invoke(MACHINE_IPC.watchDirs, args),
  readFile: (args) => ipcRenderer.invoke(MACHINE_IPC.readFile, args),
  writeFile: (args) => ipcRenderer.invoke(MACHINE_IPC.writeFile, args),
  createDir: (args) => ipcRenderer.invoke(MACHINE_IPC.createDir, args),
  rename: (args) => ipcRenderer.invoke(MACHINE_IPC.rename, args),
  remove: (args) => ipcRenderer.invoke(MACHINE_IPC.remove, args),
  upload: (args) => ipcRenderer.invoke(MACHINE_IPC.upload, args),
  download: (args) => ipcRenderer.invoke(MACHINE_IPC.download, args),
  downloadUrl: (args) => ipcRenderer.invoke(MACHINE_IPC.downloadUrl, args),
  cancelTransfer: (args) => ipcRenderer.invoke(MACHINE_IPC.cancelTransfer, args),
  listTransfers: () => ipcRenderer.invoke(MACHINE_IPC.listTransfers),
  clearFinishedTransfers: () => ipcRenderer.invoke(MACHINE_IPC.clearFinishedTransfers),
  startDrag: (args) => ipcRenderer.send(MACHINE_IPC.startDrag, args),
  onTransferUpdated: (callback) => subscribe(MACHINE_IPC.transferUpdated, callback),
  onDirChanged: (callback) => subscribe(MACHINE_IPC.dirChanged, callback),
  list: () => ipcRenderer.invoke(MACHINE_IPC.list),
  onChanged: (callback) => subscribe(MACHINE_IPC.changed, () => callback()),
  setConnection: (args) => ipcRenderer.invoke(MACHINE_IPC.setConnection, args),
  renameMachine: (args) => ipcRenderer.invoke(MACHINE_IPC.renameMachine, args),
  adopt: (args) => ipcRenderer.invoke(MACHINE_IPC.adopt, args),
  separate: (args) => ipcRenderer.invoke(MACHINE_IPC.separate, args),
  connect: (args) => ipcRenderer.invoke(MACHINE_IPC.connect, args),
  shellOpen: (args) => ipcRenderer.invoke(MACHINE_IPC.shellOpen, args),
  shellWrite: (args) => ipcRenderer.invoke(MACHINE_IPC.shellWrite, args),
  shellResize: (args) => ipcRenderer.invoke(MACHINE_IPC.shellResize, args),
  shellClose: (args) => ipcRenderer.invoke(MACHINE_IPC.shellClose, args),
  onShellEvent: (callback) => subscribe(MACHINE_IPC.shellEvent, callback),
  detectCommands: (args) => ipcRenderer.invoke(MACHINE_IPC.detectCommands, args),
  listWorktrees: (args) => ipcRenderer.invoke(MACHINE_IPC.listWorktrees, args),
  createWorktree: (args) => ipcRenderer.invoke(MACHINE_IPC.createWorktree, args),
  removeWorktree: (args) => ipcRenderer.invoke(MACHINE_IPC.removeWorktree, args),
  listProcesses: (args) => ipcRenderer.invoke(MACHINE_IPC.listProcesses, args),
  signalProcess: (args) => ipcRenderer.invoke(MACHINE_IPC.signalProcess, args),
  listDockerContainers: (args) => ipcRenderer.invoke(MACHINE_IPC.listDockerContainers, args),
  dockerContainerAction: (args) => ipcRenderer.invoke(MACHINE_IPC.dockerContainerAction, args),
  listDiskMounts: (args) => ipcRenderer.invoke(MACHINE_IPC.listDiskMounts, args),
  measureDiskUsage: (args) => ipcRenderer.invoke(MACHINE_IPC.measureDiskUsage, args),
  scanCleanup: (args) => ipcRenderer.invoke(MACHINE_IPC.scanCleanup, args),
  runCleanup: (args) => ipcRenderer.invoke(MACHINE_IPC.runCleanup, args),
  completeFolder: (args) => ipcRenderer.invoke(MACHINE_IPC.completeFolder, args),
  openFolder: (args) => ipcRenderer.invoke(MACHINE_IPC.openFolder, args),
  recentFolders: (args) => ipcRenderer.invoke(MACHINE_IPC.recentFolders, args)
}
