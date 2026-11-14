import type { MachineId } from '../../../shared/machines/machine-types'
import { startSpan } from '../../observability/tracer'
import type { MachineTransport } from '../connection/machine-connection'
import type { DiskIndexFailure } from './machine-disk-live-answer'

export type DiskIndexStartState =
  | { outcome: 'answering' }
  | ({ outcome: 'failed' } & DiskIndexFailure)
  | { outcome: 'skipped'; detail: string }

/** A machine that keeps failing the same way is written down again this often. */
const REPEAT_FAILURE_AFTER_MS = 30 * 60_000

const lastLogged = new Map<MachineId, { key: string; at: number }>()

function describe(state: DiskIndexStartState): string {
  if (state.outcome === 'answering') {
    return 'the disk index is answering'
  }
  if (state.outcome === 'skipped') {
    return `the disk index is not started here: ${state.detail}`
  }
  return `the disk index is not available (${state.reason})${state.detail ? `: ${state.detail}` : ''}`
}

/**
 * Records each change in whether a machine's index answers. Console output is not kept in a
 * packaged build, so the line also goes to the local trace file (main.trace.ndjson on the desktop,
 * orcad.trace.ndjson on a server), which redacts paths on its own.
 */
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
  const line = `[disk-index] ${machine.transport} machine ${machine.machineId}: ${describe(state)}`
  if (state.outcome === 'failed') {
    console.warn(line)
  } else {
    console.info(line)
  }
  try {
    startSpan('machines.disk-index', {
      attributes: {
        machineId: machine.machineId,
        transport: machine.transport,
        outcome: state.outcome,
        reason: state.outcome === 'failed' ? state.reason : null,
        detail: state.outcome === 'answering' ? null : state.detail
      }
    }).end()
  } catch {
    // Diagnostics must never fail the request they describe.
  }
}
