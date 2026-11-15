import type { MachineId } from '../../../shared/machines/machine-types'
import { flushActiveSink, startSpan } from '../../observability/tracer'
import type { MachineTransport } from '../connection/machine-connection'
import type { DiskIndexFailure } from './machine-disk-live-answer'

export type DiskIndexStartState =
  | { outcome: 'answering' }
  | ({ outcome: 'failed' } & DiskIndexFailure)
  | { outcome: 'skipped'; detail: string }

export type DiskIndexKeptState = 'answering' | 'not-available' | 'not-supported'

/** What woke the keeper: its own start, the pass timer, or the watchdog a minute behind it. */
export type DiskIndexKeeperWake = 'start' | 'timer' | 'watchdog'

export type DiskIndexKeeperEvent =
  | { event: 'started' }
  /** Written before the keeper looks at any machine. `lateMs` is how long after its time it woke. */
  | { event: 'pass-due'; pass: number; by: DiskIndexKeeperWake; lateMs: number }
  | {
      event: 'pass-began'
      pass: number
      /** This computer first, then the other machines Seal is talking to. */
      machineIds: readonly MachineId[]
      /** Other machines Seal knows and is not talking to now. */
      notConnected: number
    }
  | {
      event: 'pass-slow'
      pass: number
      runningForMs: number
      /** `step` is what the start was doing when last heard from. */
      waitingOn: readonly { machineId: MachineId; step: string | null }[]
    }
  | {
      event: 'pass'
      pass: number
      /** `asked` is false for a machine that was not due. */
      machines: readonly { machineId: MachineId; state: DiskIndexKeptState; asked: boolean }[]
      notConnected: number
      errors: readonly string[]
      nextPassInMs: number
    }

/** A machine that keeps failing the same way is written down again this often. */
const REPEAT_FAILURE_AFTER_MS = 30 * 60_000

const lastLogged = new Map<MachineId, { key: string; at: number }>()

/**
 * Console output is not kept in a packaged build, so every line goes to the local trace file first
 * (main.trace.ndjson on the desktop, orcad.trace.ndjson on a server), which redacts paths on its
 * own. Neither sink may fail the work the line describes.
 */
function write(
  span: string,
  attributes: Record<string, unknown>,
  line: string,
  warn: boolean
): void {
  try {
    startSpan(span, { attributes }).end()
  } catch {
    // The console line below still says it.
  }
  try {
    if (warn) {
      console.warn(`[disk-index] ${line}`)
    } else {
      console.info(`[disk-index] ${line}`)
    }
  } catch {
    // A closed stdout must not end the keeping.
  }
}

function describe(state: DiskIndexStartState): string {
  if (state.outcome === 'answering') {
    return 'the disk index is answering'
  }
  if (state.outcome === 'skipped') {
    return `the disk index is not started here: ${state.detail}`
  }
  return `the disk index is not available (${state.reason})${state.detail ? `: ${state.detail}` : ''}`
}

/** Records each change in whether a machine's index answers, as a `machines.disk-index` span. */
export function logDiskIndexStart(
  machine: { machineId: MachineId; transport: MachineTransport },
  state: DiskIndexStartState
): void {
  const key = JSON.stringify(state)
  const last = lastLogged.get(machine.machineId)
  const repeatDue =
    state.outcome === 'failed' && Date.now() - (last?.at ?? 0) > REPEAT_FAILURE_AFTER_MS
  if (last?.key === key && !repeatDue) {
    return
  }
  lastLogged.set(machine.machineId, { key, at: Date.now() })
  write(
    'machines.disk-index',
    {
      machineId: machine.machineId,
      transport: machine.transport,
      outcome: state.outcome,
      reason: state.outcome === 'failed' ? state.reason : null,
      detail: state.outcome === 'answering' ? null : state.detail
    },
    `${machine.transport} machine ${machine.machineId}: ${describe(state)}`,
    state.outcome === 'failed'
  )
}

function seconds(ms: number): number {
  return Math.round(ms / 1000)
}

function otherMachines(connected: number, notConnected: number): string {
  return connected + notConnected === 0
    ? 'no other machine is known'
    : `${connected} other machine(s) connected, ${notConnected} not connected`
}

/** A pass that woke this late was held back, which is worth a warning. */
const LATE_WAKE_WARNING_MS = 60_000

/**
 * Records that the keeper is running, what woke each pass and how late, and what the pass looked
 * at and found, as `machines.disk-index.keeper` spans. Each is on disk before the keeper goes on,
 * so a step that stops the process cannot take the record of the step before it along.
 */
export function logDiskIndexKeeper(event: DiskIndexKeeperEvent): void {
  writeKeeperEvent(event)
  flushActiveSink()
}

function writeKeeperEvent(event: DiskIndexKeeperEvent): void {
  const span = 'machines.disk-index.keeper'
  if (event.event === 'started') {
    write(
      span,
      { event: 'started', pid: process.pid },
      `keeper started in process ${process.pid}`,
      false
    )
    return
  }
  if (event.event === 'pass-due') {
    const lateBySeconds = seconds(event.lateMs)
    write(
      span,
      { event: 'pass-due', pass: event.pass, by: event.by, lateBySeconds },
      `keeper pass ${event.pass} is due (${event.by}; ${lateBySeconds} s late)`,
      event.by === 'watchdog' || event.lateMs >= LATE_WAKE_WARNING_MS
    )
    return
  }
  if (event.event === 'pass-slow') {
    const waitingOn = event.waitingOn
      .map(({ machineId, step }) => (step ? `${machineId} (${step})` : machineId))
      .join(', ')
    const runningForSeconds = seconds(event.runningForMs)
    write(
      span,
      { event: 'pass-slow', pass: event.pass, runningForSeconds, waitingOn: waitingOn || null },
      `keeper pass ${event.pass} has run for ${runningForSeconds} s and is waiting for: ${waitingOn || 'no machine'}`,
      true
    )
    return
  }
  if (event.event === 'pass-began') {
    const otherMachinesConnected = Math.max(0, event.machineIds.length - 1)
    write(
      span,
      {
        event: 'pass-began',
        pass: event.pass,
        machines: event.machineIds.join(', '),
        otherMachinesConnected,
        otherMachinesNotConnected: event.notConnected
      },
      `keeper pass ${event.pass} began: ${event.machineIds.join(', ')}; ${otherMachines(otherMachinesConnected, event.notConnected)}`,
      false
    )
    return
  }
  const machines = event.machines
    .map(({ machineId, state, asked }) => `${machineId} ${state}${asked ? '' : ' (not due)'}`)
    .join(', ')
  const errors = event.errors.length > 0 ? event.errors.join(' | ') : null
  const nextPassInSeconds = seconds(event.nextPassInMs)
  write(
    span,
    {
      event: 'pass',
      pass: event.pass,
      machines: machines || null,
      otherMachinesNotConnected: event.notConnected,
      errors,
      nextPassInSeconds
    },
    `keeper pass ${event.pass}: ${machines || 'no machine was looked at'}; ` +
      `${errors ? `errors: ${errors}; ` : ''}next pass in ${nextPassInSeconds} s`,
    errors !== null
  )
}
