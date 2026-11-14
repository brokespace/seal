import { app } from 'electron'
import { expandMachineFolderInput } from '../../../shared/machines/machine-folder-input'
import { machinePathDirname } from '../../../shared/machines/machine-paths'
import type {
  MachineFolderCompletion,
  MachineFolderOpenResult
} from '../../../shared/machines/machine-resource-types'
import { MACHINE_IPC, type MachineId } from '../../../shared/machines/machine-types'
import type { MachineFileSystem } from '../filesystem/machine-filesystem'
import { machineIdOf, requireString, type MachineInvokeRegistrar } from '../machine-ipc-args'
import type { MachineDirectoryService } from './machine-directory-service'
import { completeMachineFolder } from './machine-folder-completion'
import { MachineRecentFoldersStore } from './machine-recent-folders-store'

export type MachineFolderIpcDeps = {
  directories: () => MachineDirectoryService
  resolveFileSystem: (machineId: MachineId) => MachineFileSystem
}

let recents: MachineRecentFoldersStore | null = null
const homeDirs = new Map<MachineId, string>()

function recentFolders(): MachineRecentFoldersStore {
  recents ??= new MachineRecentFoldersStore(app.getPath('userData'))
  return recents
}

function withoutTrailingSeparator(path: string): string {
  return machinePathDirname(path) === null ? path : path.replace(/[\\/]+$/, '')
}

export function registerMachineFolderHandlers(
  handle: MachineInvokeRegistrar,
  deps: MachineFolderIpcDeps
): void {
  const expand = async (machineId: MachineId, args: Record<string, unknown>): Promise<string> => {
    let homeDir = homeDirs.get(machineId)
    if (!homeDir) {
      homeDir = await deps.resolveFileSystem(machineId).homeDir()
      homeDirs.set(machineId, homeDir)
    }
    const expanded = expandMachineFolderInput(requireString(args.input, 'input'), {
      homeDir,
      currentDir: typeof args.currentDir === 'string' ? args.currentDir : null
    })
    if (!expanded) {
      throw new Error('Type a folder path')
    }
    return expanded
  }

  handle(MACHINE_IPC.completeFolder, async (args): Promise<MachineFolderCompletion> => {
    const machineId = machineIdOf(args.machineId)
    const expanded = await expand(machineId, args)
    return completeMachineFolder(
      (path, offset) => deps.directories().listDir(machineId, path, { offset }),
      expanded
    )
  })

  handle(MACHINE_IPC.openFolder, async (args): Promise<MachineFolderOpenResult> => {
    const machineId = machineIdOf(args.machineId)
    const path = withoutTrailingSeparator(await expand(machineId, args))
    try {
      const stat = await deps.resolveFileSystem(machineId).stat(path)
      if (!stat.isDirectoryLike) {
        return { ok: false, message: `${path} is not a folder.` }
      }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
    recentFolders().remember(machineId, path)
    return { ok: true, path }
  })

  handle(MACHINE_IPC.recentFolders, (args) => recentFolders().list(machineIdOf(args.machineId)))
}
