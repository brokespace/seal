import {
  LOCAL_MACHINE_ID,
  type MachineDirChangedEvent,
  type MachineId,
  type MachineTransfer
} from '../../shared/machines/machine-types'
import type { MachineView } from '../../shared/machines/machine-view'
import { machinePathDirname } from '../../shared/machines/machine-paths'
import { getAppEnvironment } from '../../shared/app-environment'
import type { MachineConnection } from './connection/machine-connection'
import type { LiveSessionMachineSource } from '../live-sessions/hosts/live-session-hosts'
import { createLocalMachineConnection } from './connection/local-machine-connection'
import type { MachineFileSystem } from './filesystem/machine-filesystem'
import { MachineDirectoryService } from './listing/machine-directory-service'
import { MachineTransferManager } from './transfers/machine-transfer-manager'
import { MachineDragOutStager } from './drag-out/machine-drag-out'

export type MachineServices = {
  directories: MachineDirectoryService
  transfers: MachineTransferManager
  dragOut: MachineDragOutStager
}

/** How this host reaches machines: the desktop's registry, or this machine alone when headless. */
export type MachineAccess = {
  views: () => readonly MachineView[]
  connection: (machineId: MachineId) => MachineConnection
  liveSessionSources: () => readonly MachineScanSource[]
}

/** `environmentId` is set when the machine connects via its Seal server. */
export type MachineScanSource = LiveSessionMachineSource & { environmentId: string | null }

let services: MachineServices | null = null
let localConnection: MachineConnection | null = null
const dirChangedListeners = new Set<(event: MachineDirChangedEvent) => void>()
const transferListeners = new Set<(transfer: MachineTransfer) => void>()

let access: MachineAccess = {
  views: () => [],
  liveSessionSources: () => [],
  connection: (machineId) => {
    if (machineId !== LOCAL_MACHINE_ID) {
      throw new Error('Unknown machine')
    }
    return (localConnection ??= createLocalMachineConnection())
  }
}

export function setMachineAccess(next: MachineAccess): void {
  access = next
}

export function listMachineViews(): readonly MachineView[] {
  return access.views()
}

export function listLiveSessionMachineSources(): readonly MachineScanSource[] {
  return access.liveSessionSources()
}

export function resolveMachineConnection(machineId: MachineId): MachineConnection {
  return access.connection(machineId)
}

export function resolveMachineFileSystem(machineId: MachineId): MachineFileSystem {
  return access.connection(machineId).files
}

export function onMachineDirChanged(listener: (event: MachineDirChangedEvent) => void): () => void {
  dirChangedListeners.add(listener)
  return () => dirChangedListeners.delete(listener)
}

export function onMachineTransferUpdated(
  listener: (transfer: MachineTransfer) => void
): () => void {
  transferListeners.add(listener)
  return () => transferListeners.delete(listener)
}

export function getMachineServices(): MachineServices {
  if (services) {
    return services
  }
  const directories = new MachineDirectoryService({
    resolveFileSystem: resolveMachineFileSystem,
    onDirChanged: (machineId, path) => {
      for (const listener of dirChangedListeners) {
        listener({ machineId, path })
      }
    }
  })
  services = {
    directories,
    transfers: new MachineTransferManager({
      resolveFileSystem: resolveMachineFileSystem,
      onUpdate: (transfer) => {
        for (const listener of transferListeners) {
          listener(transfer)
        }
      },
      onRemoteDirChanged: (machineId, dir) => directories.invalidate(machineId, dir)
    }),
    dragOut: new MachineDragOutStager(resolveMachineFileSystem)
  }
  getAppEnvironment().onWillQuit(() => {
    services?.transfers.dispose()
    services?.directories.dispose()
    void services?.dragOut.dispose()
  })
  return services
}

export function invalidateMachineParentDir(machineId: MachineId, target: string): void {
  const parent = machinePathDirname(target)
  if (parent) {
    getMachineServices().directories.invalidate(machineId, parent)
  }
}

/** Deletes each path, refusing filesystem roots. */
export async function removeMachinePaths(machineId: MachineId, paths: string[]): Promise<void> {
  const fs = resolveMachineFileSystem(machineId)
  for (const path of paths) {
    if (machinePathDirname(path) === null) {
      throw new Error('Refusing to delete a filesystem root')
    }
    await fs.remove(path)
    invalidateMachineParentDir(machineId, path)
  }
}
