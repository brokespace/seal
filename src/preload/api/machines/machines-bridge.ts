import { ipcRenderer } from 'electron'
import {
  MACHINE_IPC,
  type MachineDirChangedEvent,
  type MachineDirListing,
  type MachineFileRead,
  type MachineId,
  type MachineMetrics,
  type MachineTransfer
} from '../../../shared/machines/machine-types'

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
  onDirChanged: (callback) => subscribe(MACHINE_IPC.dirChanged, callback)
}
