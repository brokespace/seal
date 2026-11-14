import { MachineConnectionTypeSchema } from '../../../shared/machines/machine-record'
import { MACHINE_IPC } from '../../../shared/machines/machine-types'
import { machineIdOf, requireString, type MachineInvokeRegistrar } from '../machine-ipc-args'
import { getMachineRegistry } from './machine-registry-service'

function connectionTypeOf(value: unknown): 'ssh' | 'server' {
  const parsed = MachineConnectionTypeSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error('Choose SSH or Seal server')
  }
  return parsed.data
}

function linkOf(
  args: Record<string, unknown>
): { sshTargetId: string } | { environmentId: string } {
  if (typeof args.sshTargetId === 'string' && args.sshTargetId) {
    return { sshTargetId: args.sshTargetId }
  }
  return { environmentId: requireString(args.environmentId, 'environmentId') }
}

export function registerMachineRegistryHandlers(handle: MachineInvokeRegistrar): void {
  handle(MACHINE_IPC.list, () => getMachineRegistry().list())

  handle(MACHINE_IPC.setConnection, (args) =>
    getMachineRegistry().setConnection(
      machineIdOf(args.machineId),
      connectionTypeOf(args.connection)
    )
  )

  handle(MACHINE_IPC.renameMachine, (args) =>
    getMachineRegistry().rename(machineIdOf(args.machineId), requireString(args.name, 'name'))
  )

  handle(MACHINE_IPC.adopt, (args) =>
    getMachineRegistry().adopt({
      link: linkOf(args),
      connection: connectionTypeOf(args.connection),
      ...(typeof args.name === 'string' && args.name.trim() ? { name: args.name } : {}),
      ...(typeof args.machineId === 'string' ? { machineId: machineIdOf(args.machineId) } : {})
    })
  )

  handle(MACHINE_IPC.separate, (args) => getMachineRegistry().separate(machineIdOf(args.machineId)))

  handle(MACHINE_IPC.connect, async (args) => {
    const machineId = machineIdOf(args.machineId)
    await getMachineRegistry().connection(machineId).connect()
    void getMachineRegistry().probeIdentity(machineId)
  })
}
