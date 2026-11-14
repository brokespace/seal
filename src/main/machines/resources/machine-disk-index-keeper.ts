import { LOCAL_MACHINE_ID, type MachineId } from '../../../shared/machines/machine-types'
import type { MachineConnection } from '../connection/machine-connection'
import { listMachineViews, resolveMachineConnection } from '../machine-services'
import { keepMachineDiskIndex } from './machine-disk-index'
import { logDiskIndexStart } from './machine-disk-index-log'

/** Startup has the disk to itself first. */
const FIRST_PASS_DELAY_MS = 30_000
/** The keeper sleeps until a machine is due: a minute after a failure, half an hour once all answer. */
const SHORTEST_PAUSE_MS = 60_000
const LONGEST_PAUSE_MS = 30 * 60_000

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
 * for runs that must leave the disk alone, and is written to the log. A machine that connects
 * between two passes is picked up by the next one, or sooner when its vitals are read.
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
  const pass = async (): Promise<void> => {
    let pause = LONGEST_PAUSE_MS
    try {
      const due = await Promise.all(connectedMachines().map(keepMachineDiskIndex))
      pause = Math.min(...due, Date.now() + LONGEST_PAUSE_MS) - Date.now()
    } catch (error) {
      // One bad pass must not end the keeping.
      console.warn('[disk-index] could not look at the machines:', error)
    }
    setTimeout(() => void pass(), Math.max(SHORTEST_PAUSE_MS, pause)).unref()
  }
  setTimeout(() => void pass(), FIRST_PASS_DELAY_MS).unref()
}
