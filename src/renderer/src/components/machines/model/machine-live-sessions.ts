import { liveSessionsOnMachine } from '../../../../../shared/live-sessions/live-session-machine-id'
import { isActiveLiveSession } from '../../../../../shared/live-sessions/live-session-status'
import { compareListedLiveSessions } from '../../../../../shared/live-sessions/live-session-summary'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import type { MachineId } from '../../../../../shared/machines/machine-types'

/** Each machine's running sessions from the registry, in Active agents' order. */
export function activeLiveSessionsByMachine(
  machines: readonly MachineSummary[],
  sessions: readonly LiveSession[]
): Map<MachineId, LiveSession[]> {
  const active = sessions.filter(isActiveLiveSession)
  const result = new Map<MachineId, LiveSession[]>()
  for (const machine of machines) {
    const onMachine = liveSessionsOnMachine(active, machine)
    if (onMachine.length > 0) {
      result.set(machine.id, onMachine.sort(compareListedLiveSessions))
    }
  }
  return result
}
