import {
  MACHINE_CPU_TEMPERATURE_SETUP_ACTIONS,
  type MachineCpuTemperatureSetupAction
} from '../../../shared/machines/machine-cpu-temperature-types'
import {
  MACHINE_CLEANUP_TARGETS,
  MACHINE_DOCKER_CONTAINER_ACTIONS,
  type MachineCleanupTargetId,
  type MachineDockerContainerAction
} from '../../../shared/machines/machine-resource-types'
import { MACHINE_IPC } from '../../../shared/machines/machine-types'
import { MachineDiskIndexRequestSchema } from '../../../shared/rpc-contract/seal-machines-params'
import type { MachineConnection } from '../connection/machine-connection'
import {
  machineIdOf,
  requireString,
  requireStrings,
  type MachineInvokeRegistrar
} from '../machine-ipc-args'
import { getMachineRegistry } from '../registry/machine-registry-service'
import { MachineCleanupRunner } from './machine-cleanup-runner'
import {
  readWindowsCpuTemperatureSetup,
  runWindowsCpuTemperatureSetup
} from './machine-cpu-temperature-windows-setup'
import { readMachineDockerStorage } from './machine-docker-cleanup-scan'
import { queryMachineDiskIndex } from './machine-disk-index'
import {
  listMachineDockerContainers,
  runMachineDockerContainerAction
} from './machine-docker-containers'
import { probeMachineProcesses } from './machine-process-probe'
import { signalMachineProcess } from './machine-process-signal'
import { rereadMachineSensors } from './machine-sensor-readings'

const cleanups = new MachineCleanupRunner()
const listings = new Map<string, AbortController>()
const temperatureSetups = new Set<string>()

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

function dockerActionOf(value: unknown): MachineDockerContainerAction {
  const action = MACHINE_DOCKER_CONTAINER_ACTIONS.find((known) => known === value)
  if (!action) {
    throw new Error('Unsupported container action')
  }
  return action
}

function cpuTemperatureSetupActionOf(value: unknown): MachineCpuTemperatureSetupAction {
  const action = MACHINE_CPU_TEMPERATURE_SETUP_ACTIONS.find((known) => known === value)
  if (!action) {
    throw new Error('Unsupported setup action')
  }
  return action
}

export function registerMachineResourceHandlers(handle: MachineInvokeRegistrar): void {
  handle(MACHINE_IPC.listProcesses, async (args) =>
    probeMachineProcesses(await connected(args.machineId), { gpus: args.gpus === true })
  )

  handle(MACHINE_IPC.signalProcess, async (args) =>
    signalMachineProcess(await connected(args.machineId), {
      pid: typeof args.pid === 'number' ? args.pid : Number.NaN,
      signal: args.signal === 'KILL' ? 'KILL' : 'TERM',
      startMarker: requireString(args.startMarker, 'startMarker')
    })
  )

  handle(MACHINE_IPC.cpuTemperatureSetup, async (args) =>
    readWindowsCpuTemperatureSetup(await connected(args.machineId))
  )

  handle(MACHINE_IPC.runCpuTemperatureSetup, async (args) => {
    const connection = await connected(args.machineId)
    const action = cpuTemperatureSetupActionOf(args.action)
    // A second Windows prompt for the same machine would race the first one's installer.
    if (temperatureSetups.has(connection.machineId)) {
      throw new Error('CPU temperature setup is already running on this machine.')
    }
    temperatureSetups.add(connection.machineId)
    try {
      const result = await runWindowsCpuTemperatureSetup(connection, action)
      await rereadMachineSensors(connection)
      return result
    } finally {
      temperatureSetups.delete(connection.machineId)
    }
  })

  handle(MACHINE_IPC.listDockerContainers, async (args) =>
    listMachineDockerContainers(await connected(args.machineId))
  )

  handle(MACHINE_IPC.dockerContainerAction, async (args) =>
    runMachineDockerContainerAction(
      await connected(args.machineId),
      requireString(args.containerId, 'containerId'),
      dockerActionOf(args.action)
    )
  )

  handle(MACHINE_IPC.dockerStorage, async (args) =>
    readMachineDockerStorage(await connected(args.machineId))
  )

  // A newer drill-down for the same machine replaces the one still reading the previous folder.
  handle(MACHINE_IPC.diskIndex, async (args) => {
    const connection = await connected(args.machineId)
    const request = MachineDiskIndexRequestSchema.parse(args.request)
    if (request.op !== 'list') {
      return queryMachineDiskIndex(connection, request)
    }
    listings.get(connection.machineId)?.abort()
    const controller = new AbortController()
    listings.set(connection.machineId, controller)
    try {
      return await queryMachineDiskIndex(connection, request, controller.signal)
    } finally {
      if (listings.get(connection.machineId) === controller) {
        listings.delete(connection.machineId)
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
