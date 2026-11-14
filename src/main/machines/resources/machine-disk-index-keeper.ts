import { LOCAL_MACHINE_ID, type MachineId } from '../../../shared/machines/machine-types'
import type { MachineConnection } from '../connection/machine-connection'
import { listMachineViews, resolveMachineConnection } from '../machine-services'
import { ensureMachineDiskIndex } from './machine-disk-index'
import { logDiskIndexStart } from './machine-disk-index-log'

/** Startup has the disk to itself first. */
const FIRST_PASS_DELAY_MS = 30_000
const PASS_EVERY_MS = 60_000

let started = false

/** This computer, and every other machine Seal is already talking to; none is dialled for this. */
function connectedMachines(): MachineConnection[] {
  const ids: MachineId[] = [LOCAL_MACHINE_ID, ...listMachineViews().map((view) => view.id)]
  return ids.flatMap((id) => {
    try {
      const connection = resolveMachineConnection(id)
      return connection.isConnected() ? [connection] : []
    } catch {
      return []
    }
  })
}

/**
 * Keeps the disk index running on this computer and on connected machines for as long as this
 * process lives, on the desktop and on a Seal server alike. It depends on nothing but the process
 * having started: no window, no open panel, and not on how the app was launched. `skipReason` is
 * for runs that must leave the disk alone, and is written to the log.
 */
export function startMachineDiskIndexKeeper(skipReason: string | null): void {
  if (started) {
    return
  }
  started = true
  if (skipReason) {
    logDiskIndexStart(
      { machineId: LOCAL_MACHINE_ID, transport: 'local' },
      { outcome: 'skipped', detail: skipReason }
    )
    return
  }
  const pass = (): void => {
    for (const connection of connectedMachines()) {
      ensureMachineDiskIndex(connection)
    }
  }
  setTimeout(() => {
    pass()
    setInterval(pass, PASS_EVERY_MS).unref()
  }, FIRST_PASS_DELAY_MS).unref()
}
