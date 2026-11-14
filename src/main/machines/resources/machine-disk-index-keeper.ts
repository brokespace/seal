import { LOCAL_MACHINE_ID, type MachineId } from '../../../shared/machines/machine-types'
import { createLocalMachineConnection } from '../connection/local-machine-connection'
import type { MachineConnection } from '../connection/machine-connection'
import { listMachineViews, resolveMachineConnection } from '../machine-services'
import { getMainE2EConfig } from '../../startup/testing/e2e-config'
import {
  diskIndexStartStep,
  keepMachineDiskIndex,
  type MachineDiskIndexKeep
} from './machine-disk-index'
import {
  logDiskIndexKeeper,
  logDiskIndexStart,
  type DiskIndexKeeperWake
} from './machine-disk-index-log'

/** The keeper sleeps until a machine is due: a minute after a failure, half an hour once all answer. */
const SHORTEST_PAUSE_MS = 60_000
const LONGEST_PAUSE_MS = 30 * 60_000
/** How long after a pass's time the watchdog looks at whether it began, and whether it ended. */
const WATCHDOG_AFTER_MS = 60_000

type KeptMachine = MachineDiskIndexKeep & { machineId: MachineId }

let started = false
let ownLocalConnection: MachineConnection | null = null
let passes = 0
let nextPassAt = 0
let running: { pass: number; beganAt: number; waitingOn: Set<MachineId> } | null = null

function said(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * This computer is kept in every pass. It needs no connection, so nothing is asked about one, and
 * a machine list that cannot hand it out does not take it away.
 */
function thisComputer(errors: string[]): MachineConnection {
  try {
    return resolveMachineConnection(LOCAL_MACHINE_ID)
  } catch (error) {
    errors.push(`the machine list did not hand out this computer: ${said(error)}`)
    return (ownLocalConnection ??= createLocalMachineConnection())
  }
}

/** The other machines Seal is already talking to; none is dialled for this. */
function otherMachines(errors: string[]): {
  connected: MachineConnection[]
  notConnected: number
} {
  const connected: MachineConnection[] = []
  let notConnected = 0
  try {
    for (const view of listMachineViews()) {
      try {
        const connection = resolveMachineConnection(view.id)
        if (connection.isConnected()) {
          connected.push(connection)
        } else {
          notConnected += 1
        }
      } catch (error) {
        errors.push(`${view.id}: ${said(error)}`)
      }
    }
  } catch (error) {
    errors.push(`the other machines could not be listed: ${said(error)}`)
  }
  return { connected, notConnected }
}

async function keep(connection: MachineConnection, errors: string[]): Promise<KeptMachine> {
  try {
    return { machineId: connection.machineId, ...(await keepMachineDiskIndex(connection)) }
  } catch (error) {
    errors.push(`${connection.machineId}: ${said(error)}`)
    return {
      machineId: connection.machineId,
      dueAt: Date.now() + SHORTEST_PAUSE_MS,
      state: 'not-available',
      asked: true
    }
  }
}

/** Looks at every machine once, writes down what it found, and says how long to sleep. */
async function runPass(pass: number, waitingOn: Set<MachineId>): Promise<number> {
  const errors: string[] = []
  let machines: KeptMachine[] = []
  let notConnected = 0
  let pause = SHORTEST_PAUSE_MS
  try {
    const local = thisComputer(errors)
    const others = otherMachines(errors)
    notConnected = others.notConnected
    const connections = [local, ...others.connected]
    logDiskIndexKeeper({
      event: 'pass-began',
      pass,
      machineIds: connections.map((connection) => connection.machineId),
      notConnected
    })
    machines = await Promise.all(
      connections.map((connection) => {
        waitingOn.add(connection.machineId)
        return keep(connection, errors).finally(() => waitingOn.delete(connection.machineId))
      })
    )
    const due = Math.min(...machines.map((machine) => machine.dueAt)) - Date.now()
    pause = Math.min(Math.max(due, SHORTEST_PAUSE_MS), LONGEST_PAUSE_MS)
  } catch (error) {
    errors.push(`the pass did not finish: ${said(error)}`)
  }
  logDiskIndexKeeper({ event: 'pass', pass, machines, notConnected, errors, nextPassInMs: pause })
  return pause
}

/** Runs that must leave the disk alone; a background launch is not one of them. */
function skipReason(launch: { orcadSidecar: boolean }): string | null {
  if (getMainE2EConfig().enabled) {
    return 'this is an end-to-end test run'
  }
  return launch.orcadSidecar ? 'this is a headless browser sidecar' : null
}

/** Sleeps until `pass` is due, with the watchdog a minute behind the timer. */
function sleepUntil(pass: number, pause: number): void {
  nextPassAt = Date.now() + pause
  setTimeout(() => wake('timer', pass), pause).unref()
  setTimeout(() => wake('watchdog', pass), pause + WATCHDOG_AFTER_MS).unref()
}

/**
 * Begins `pass` unless it has begun already. Its timer and its watchdog both end here, so a pass
 * whose timer never fired is begun by the watchdog, and one still running when the watchdog looks
 * is written down with the machines it is waiting for. What woke the pass, and how late, is on
 * disk before any machine is looked at.
 */
function wake(by: DiskIndexKeeperWake, pass: number): void {
  const now = Date.now()
  if (pass <= passes) {
    if (by === 'watchdog' && running?.pass === pass) {
      logDiskIndexKeeper({
        event: 'pass-slow',
        pass,
        runningForMs: now - running.beganAt,
        waitingOn: [...running.waitingOn].map((machineId) => ({
          machineId,
          step: diskIndexStartStep(machineId)
        }))
      })
    }
    return
  }
  passes = pass
  logDiskIndexKeeper({ event: 'pass-due', pass, by, lateMs: Math.max(0, now - nextPassAt) })
  const waitingOn = new Set<MachineId>()
  running = { pass, beganAt: now, waitingOn }
  void runPass(pass, waitingOn)
    // One bad pass must not end the keeping.
    .catch(() => SHORTEST_PAUSE_MS)
    .then((pause) => {
      running = null
      sleepUntil(pass + 1, pause)
    })
}

/**
 * Keeps the disk index running on this computer and on connected machines for as long as this
 * process lives, on the desktop and on a Seal server alike. It depends on nothing but the process
 * having started: no window, no open panel, and not how the app was launched. The first pass
 * begins inside this call and waits for no timer, so a timer that is late or never fires cannot
 * cost the start. Everything it does is written to the trace file: that it started (or why not),
 * what woke each pass and how late, and what the pass looked at and found. A machine that
 * connects between two passes is picked up by the next one, or sooner when its vitals are read.
 */
export function startMachineDiskIndexKeeper(launch: { orcadSidecar: boolean }): void {
  if (started) {
    return
  }
  started = true
  const skipped = skipReason(launch)
  if (skipped) {
    logDiskIndexStart(
      { machineId: LOCAL_MACHINE_ID, transport: 'local' },
      { outcome: 'skipped', detail: skipped }
    )
    return
  }
  logDiskIndexKeeper({ event: 'started' })
  nextPassAt = Date.now()
  setTimeout(() => wake('watchdog', 1), WATCHDOG_AFTER_MS).unref()
  wake('start', 1)
}
