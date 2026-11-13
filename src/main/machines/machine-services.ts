import { parseExecutionHostId } from '../../shared/execution-host'
import type {
  MachineDirChangedEvent,
  MachineId,
  MachineTransfer
} from '../../shared/machines/machine-types'
import { machinePathDirname } from '../../shared/machines/machine-paths'
import { getAppEnvironment } from '../../shared/app-environment'
import type { MachineFileSystem } from './filesystem/machine-filesystem'
import { createLocalMachineFileSystem } from './filesystem/local-machine-filesystem'
import { SshMachineFileSystem } from './filesystem/ssh-machine-filesystem'
import { MachineDirectoryService } from './listing/machine-directory-service'
import { MachineTransferManager } from './transfers/machine-transfer-manager'
import { MachineDragOutStager } from './drag-out/machine-drag-out'
import { getSshTargetRegistryStore } from '../ssh/targets/ssh-target-registry'
import { RuntimeMachineFileSystem } from './runtime/runtime-machine-filesystem'
import { createRuntimeMachineChannel } from './runtime/runtime-machine-channel'

export type MachineServices = {
  directories: MachineDirectoryService
  transfers: MachineTransferManager
  dragOut: MachineDragOutStager
}

let services: MachineServices | null = null
const fileSystems = new Map<MachineId, MachineFileSystem>()
const runtimeFileSystems = new Map<string, RuntimeMachineFileSystem>()
const dirChangedListeners = new Set<(event: MachineDirChangedEvent) => void>()
const transferListeners = new Set<(transfer: MachineTransfer) => void>()

export function resolveRuntimeMachineFileSystem(environmentId: string): RuntimeMachineFileSystem {
  let fs = runtimeFileSystems.get(environmentId)
  if (!fs) {
    fs = new RuntimeMachineFileSystem(
      environmentId,
      createRuntimeMachineChannel(getAppEnvironment().getPath('userData'), environmentId)
    )
    runtimeFileSystems.set(environmentId, fs)
  }
  return fs
}

export function resolveMachineFileSystem(machineId: MachineId): MachineFileSystem {
  const existing = fileSystems.get(machineId)
  if (existing) {
    return existing
  }
  const parsed = parseExecutionHostId(machineId)
  let fs: MachineFileSystem
  if (parsed?.kind === 'local') {
    fs = createLocalMachineFileSystem()
  } else if (parsed?.kind === 'ssh' && getSshTargetRegistryStore()?.getTarget(parsed.targetId)) {
    fs = new SshMachineFileSystem(parsed.targetId)
  } else if (parsed?.kind === 'runtime') {
    fs = resolveRuntimeMachineFileSystem(parsed.environmentId)
  } else {
    throw new Error('Unknown machine')
  }
  fileSystems.set(machineId, fs)
  return fs
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
