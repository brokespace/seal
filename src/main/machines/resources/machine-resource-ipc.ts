import {
  MACHINE_CLEANUP_TARGETS,
  type MachineCleanupTargetId
} from '../../../shared/machines/machine-resource-types'
import { MACHINE_IPC } from '../../../shared/machines/machine-types'
import type { MachineConnection } from '../connection/machine-connection'
import {
  machineIdOf,
  requireString,
  requireStrings,
  type MachineInvokeRegistrar
} from '../machine-ipc-args'
import { getMachineRegistry } from '../registry/machine-registry-service'
import { MachineCleanupRunner } from './machine-cleanup-runner'
import { listMachineDiskMounts, measureMachineDiskUsage } from './machine-disk-usage'
import {
  listMachineDockerContainers,
  runMachineDockerContainerAction
} from './machine-docker-containers'
import { probeMachineProcesses } from './machine-process-probe'
import { signalMachineProcess } from './machine-process-signal'

const cleanups = new MachineCleanupRunner()
const usageScans = new Map<string, AbortController>()

async function connected(machineId: unknown): Promise<MachineConnection> {
  const connection = getMachineRegistry().connection(machineIdOf(machineId))
  await connection.connect()
  return connection
}

function cleanupTargetOf(value: unknown): MachineCleanupTargetId {
  const target = MACHINE_CLEANUP_TARGETS.find((known) => known === value)
  if (!target) {
    throw new Error('Unknown cleanup target')
  }
  return target
}

export function registerMachineResourceHandlers(handle: MachineInvokeRegistrar): void {
  handle(MACHINE_IPC.listProcesses, async (args) =>
    probeMachineProcesses(await connected(args.machineId))
  )

  handle(MACHINE_IPC.signalProcess, async (args) =>
    signalMachineProcess(await connected(args.machineId), {
      pid: typeof args.pid === 'number' ? args.pid : Number.NaN,
      signal: args.signal === 'KILL' ? 'KILL' : 'TERM',
      startMarker: requireString(args.startMarker, 'startMarker')
    })
  )

  handle(MACHINE_IPC.listDockerContainers, async (args) =>
    listMachineDockerContainers(await connected(args.machineId))
  )

  handle(MACHINE_IPC.dockerContainerAction, async (args) =>
    runMachineDockerContainerAction(
      await connected(args.machineId),
      requireString(args.containerId, 'containerId'),
      args.action === 'restart' ? 'restart' : 'stop'
    )
  )

  handle(MACHINE_IPC.listDiskMounts, async (args) =>
    listMachineDiskMounts(await connected(args.machineId))
  )

  // A newer drill-down for the same machine replaces the one still walking the previous folder.
  handle(MACHINE_IPC.measureDiskUsage, async (args) => {
    const connection = await connected(args.machineId)
    usageScans.get(connection.machineId)?.abort()
    const controller = new AbortController()
    usageScans.set(connection.machineId, controller)
    try {
      return await measureMachineDiskUsage(
        connection,
        requireString(args.path, 'path'),
        controller.signal
      )
    } finally {
      if (usageScans.get(connection.machineId) === controller) {
        usageScans.delete(connection.machineId)
      }
    }
  })

  handle(MACHINE_IPC.scanCleanup, async (args) =>
    cleanups.scan(await connected(args.machineId), cleanupTargetOf(args.target))
  )

  handle(MACHINE_IPC.runCleanup, async (args) =>
    cleanups.run(
      await connected(args.machineId),
      requireString(args.token, 'token'),
      requireStrings(args.itemIds, 'itemIds')
    )
  )
}
