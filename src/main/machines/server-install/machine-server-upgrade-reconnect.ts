/** After an app update, reconnects machines on a Seal-installed server so the connect-time check upgrades it. */
import { getAppEnvironment } from '../../../shared/app-environment'
import type { MachineRecord } from '../../../shared/machines/machine-record'
import { machinesAwaitingServerUpgrade } from '../../../shared/machines/machine-server-install'
import { connectRegisteredSshTarget } from '../../ssh/targets/ssh-target-registry'
import { getMachineRegistry } from '../registry/machine-registry-service'

// Lets the window's own launch reconnects go first; these join them instead of racing them.
const START_DELAY_MS = 5_000

let started = false

/** Once per app start; a machine that cannot be reached is tried again on the next start. */
export function startMachineServerUpgradeReconnects(): void {
  if (started) {
    return
  }
  started = true
  const timer = setTimeout(() => void reconnectMachinesAwaitingServerUpgrade(), START_DELAY_MS)
  timer.unref()
}

async function reconnectMachinesAwaitingServerUpgrade(): Promise<void> {
  let waiting: MachineRecord[]
  try {
    waiting = machinesAwaitingServerUpgrade(
      getMachineRegistry().reconcile().machines,
      getAppEnvironment().getVersion()
    )
  } catch (error) {
    console.warn('[machines] could not list machines whose Seal server needs an upgrade:', error)
    return
  }
  for (const machine of waiting) {
    if (!machine.sshTargetId) {
      continue
    }
    try {
      // Automatic: no sign-in prompt appears and a Disconnect stays.
      await connectRegisteredSshTarget(machine.sshTargetId, { automatic: true })
    } catch (error) {
      console.info(
        `[machines] ${machine.name} was not reconnected to upgrade its Seal server:`,
        error instanceof Error ? error.message : error
      )
    }
  }
}
