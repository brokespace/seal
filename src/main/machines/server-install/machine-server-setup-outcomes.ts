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
import { toMachineId } from '../../../shared/machines/machine-types'
import type { SshManagedServerUpdateNote } from '../../../shared/ssh-types'
import type { SshServerSetupOutcomes } from '../../ssh/host-server/ssh-direct-connect-policy'
import {
  connectRegisteredSshTarget,
  getSshConnectionManager
} from '../../ssh/targets/ssh-target-registry'
import type { MachineRegistry } from '../registry/machine-registry'
import { removeServiceOfFailedInstall } from './failed-install-service-cleanup'
import {
  isPm2Wished,
  isServerBeingRemoved,
  joinMachineServerInstall,
  latestSealServiceOutcome,
  noteBlockedServerMove,
  noteSealServiceOutcome
} from './machine-server-install-activity'
import {
  blockedServerMove,
  busyHostReason,
  deferredServerInstallReason,
  hostIsBusyWithAnotherInstall,
  repeatsOverPlainSsh,
  serverInstallFailureReason
} from './machine-server-install-failure'

// Another desktop's install takes about a minute; after these the machine keeps its Retry.
const BUSY_HOST_RETRY_DELAYS_MS = [10_000, 30_000, 60_000]

/**
 * The app version the server runs, as far as this connect knows: this app's unless the server kept
 * its own. `null` is a newer server, whose version is not known here; `undefined` keeps the record's.
 */
function servedVersion(
  update: SshManagedServerUpdateNote | undefined,
  appVersion: string
): string | null | undefined {
  if (!update) {
    return appVersion
  }
  return update.state === 'host-newer' ? null : undefined
}

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

  const busyHostRetries = new Map<string, number>()

  /** The host was busy with another install: the same connect, again, once that one has had time to end. False when the tries are used up. */
  const retryWhenHostIsFree = (sshTargetId: string): boolean => {
    const tried = busyHostRetries.get(sshTargetId) ?? 0
    const delay = BUSY_HOST_RETRY_DELAYS_MS[tried]
    if (delay === undefined) {
      return false
    }
    busyHostRetries.set(sshTargetId, tried + 1)
    const timer = setTimeout(() => {
      const record = registry.recordForSshTarget(sshTargetId)
      const install = record?.serverInstall
      if (!record || install?.state !== 'pending' || !install.reason) {
        return
      }
      console.info(`[machines] trying the waiting Seal server install on ${record.name} again`)
      void joinMachineServerInstall(record.id, async () => {
        // Automatic: no sign-in prompt appears and a Disconnect stays.
        await connectRegisteredSshTarget(sshTargetId, { automatic: true })
        return registry.view(toMachineId(record.id))
      }).catch((error: unknown) => {
        console.info(
          '[machines] could not try a waiting Seal server install again:',
          error instanceof Error ? error.message : error
        )
      })
    }, delay)
    timer.unref()
    return true
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
    const busy = hostIsBusyWithAnotherInstall(failure)
    const deferred = busy
      ? busyHostReason(retryWhenHostIsFree(sshTargetId))
      : deferredServerInstallReason(failure)
    const reason = deferred ?? serverInstallFailureReason(failure)
    if (!busy) {
      busyHostRetries.delete(sshTargetId)
      // Only a launch of this app reports a manager, so the service is this install's own.
      if ((latestSealServiceOutcome(sshTargetId)?.manager ?? 'detached') !== 'detached') {
        removeServiceOfFailedInstall(sshTargetId)
      }
    }
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

  const served = (
    sshTargetId: string,
    environmentId: string,
    update: SshManagedServerUpdateNote | undefined
  ): void => {
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
    busyHostRetries.delete(sshTargetId)
    noteBlockedServerMove(sshTargetId, null)
    registry.edit((store, now) =>
      completeMachineServerInstall(
        store,
        record.id,
        { environmentId, version: servedVersion(update, appVersion()), keeper },
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
      served: (sshTargetId, environmentId, update) => {
        try {
          served(sshTargetId, environmentId, update)
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
