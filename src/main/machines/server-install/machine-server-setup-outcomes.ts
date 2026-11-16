/** Turns what the SSH connect flow and the host's service report into the machine's install record. */
import {
  awaitsServerInstall,
  completeMachineServerInstall,
  deferMachineServerInstall,
  failMachineServerInstall,
  noteMachineServerKeeper,
  prefersPm2
} from '../../../shared/machines/machine-server-install'
import type {
  SealServiceOutcome,
  SealServiceWish
} from '../../managed-server/service/seal-service-policy'
import { readSealServiceState } from '../../managed-server/service/seal-service-removal'
import type { SshServerSetupOutcomes } from '../../ssh/host-server/ssh-direct-connect-policy'
import { getSshConnectionManager } from '../../ssh/targets/ssh-target-registry'
import type { MachineRegistry } from '../registry/machine-registry'
import {
  isPm2Wished,
  isServerBeingRemoved,
  latestSealServiceOutcome,
  noteBlockedServerMove,
  noteSealServiceOutcome
} from './machine-server-install-activity'
import {
  blockedServerMove,
  deferredServerInstallReason,
  repeatsOverPlainSsh,
  serverInstallFailureReason
} from './machine-server-install-failure'

export type MachineServerSetup = {
  outcomes: SshServerSetupOutcomes
  serviceWish: (sshTargetId: string) => SealServiceWish | null
  serviceOutcome: (sshTargetId: string, outcome: SealServiceOutcome) => void
}

export function createMachineServerSetup(
  registry: MachineRegistry,
  appVersion: () => string
): MachineServerSetup {
  const serviceOutcome = (sshTargetId: string, outcome: SealServiceOutcome): void => {
    noteSealServiceOutcome(sshTargetId, outcome)
    const record = registry.recordForSshTarget(sshTargetId)
    if (record) {
      registry.edit((store, now) => noteMachineServerKeeper(store, record.id, outcome, now))
    }
  }

  // A server that was already running reports nothing on connect, so its service is asked once.
  const learnServiceState = async (sshTargetId: string): Promise<void> => {
    const connection = getSshConnectionManager()?.getConnection(sshTargetId)
    const outcome = connection ? await readSealServiceState(connection) : null
    if (outcome && !latestSealServiceOutcome(sshTargetId)) {
      serviceOutcome(sshTargetId, outcome)
    }
  }

  const failed = (sshTargetId: string, failure: unknown): boolean => {
    const waiting = registry.recordForSshTarget(sshTargetId)
    if (!awaitsServerInstall(waiting?.serverInstall) || repeatsOverPlainSsh(failure)) {
      return false
    }
    // Binds a server the failed setup left registered, so the record below keeps it off.
    registry.reconcile()
    const record = registry.recordForSshTarget(sshTargetId)
    if (!record) {
      return false
    }
    const deferred = deferredServerInstallReason(failure)
    const reason = deferred ?? serverInstallFailureReason(failure)
    noteBlockedServerMove(sshTargetId, deferred ? null : blockedServerMove(failure))
    registry.edit((store, now) =>
      (deferred ? deferMachineServerInstall : failMachineServerInstall)(
        store,
        record.id,
        reason,
        now
      )
    )
    return true
  }

  const served = (sshTargetId: string, environmentId: string): void => {
    // Merges the server's fresh record into the SSH machine that deployed it.
    registry.reconcile()
    const record = registry.recordForSshTarget(sshTargetId)
    if (!record) {
      return
    }
    const keeper = latestSealServiceOutcome(sshTargetId)
    if (!keeper) {
      void learnServiceState(sshTargetId).catch((error: unknown) => {
        console.info('[machines] could not read how the Seal server is kept running:', error)
      })
    }
    if (record.serverInstall?.policy !== 'auto') {
      return
    }
    noteBlockedServerMove(sshTargetId, null)
    registry.edit((store, now) =>
      completeMachineServerInstall(
        store,
        record.id,
        { environmentId, version: appVersion(), keeper },
        now
      )
    )
  }

  return {
    outcomes: {
      // The connect flow publishes its own failure; an error here must never replace it.
      failed: (sshTargetId, failure) => {
        try {
          return failed(sshTargetId, failure)
        } catch (error) {
          console.warn('[machines] could not record a failed Seal server install:', error)
          return false
        }
      },
      served: (sshTargetId, environmentId) => {
        try {
          served(sshTargetId, environmentId)
        } catch (error) {
          console.warn('[machines] could not record an installed Seal server:', error)
        }
      }
    },
    serviceWish: (sshTargetId) => {
      const install = registry.recordForSshTarget(sshTargetId)?.serverInstall
      if (install?.policy !== 'auto' || isServerBeingRemoved(sshTargetId)) {
        return null
      }
      return prefersPm2(install) || isPm2Wished(sshTargetId) ? { prefer: 'pm2' } : {}
    },
    serviceOutcome
  }
}
