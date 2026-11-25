import { MACHINE_IPC } from '../../../shared/machines/machine-types'
import { machineIdOf, requireString, type MachineInvokeRegistrar } from '../machine-ipc-args'
import { getMachineRegistry } from '../registry/machine-registry-service'
import { detectMachineCommands } from './machine-agent-launch'
import {
  createMachineWorktree,
  listMachineWorktrees,
  removeMachineWorktree
} from './machine-worktrees'

async function connected(machineId: unknown) {
  const connection = getMachineRegistry().connection(machineIdOf(machineId))
  await connection.connect()
  return connection
}

export function registerMachineWorkHandlers(handle: MachineInvokeRegistrar): void {
  handle(MACHINE_IPC.detectCommands, async (args) =>
    detectMachineCommands(
      await connected(args.machineId),
      Array.isArray(args.commands)
        ? args.commands.filter((name): name is string => typeof name === 'string')
        : []
    )
  )

  handle(MACHINE_IPC.listWorktrees, async (args) =>
    listMachineWorktrees(await connected(args.machineId), requireString(args.repoPath, 'repoPath'))
  )

  handle(MACHINE_IPC.createWorktree, async (args) =>
    createMachineWorktree(await connected(args.machineId), {
      repoPath: requireString(args.repoPath, 'repoPath'),
      path: requireString(args.path, 'path'),
      branch: requireString(args.branch, 'branch'),
      ...(typeof args.base === 'string' && args.base ? { base: args.base } : {})
    })
  )

  handle(MACHINE_IPC.removeWorktree, async (args) =>
    removeMachineWorktree(await connected(args.machineId), {
      repoPath: requireString(args.repoPath, 'repoPath'),
      path: requireString(args.path, 'path'),
      force: args.force === true,
      unlock: args.unlock === true
    })
  )
}
