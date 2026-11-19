/** A warning about how the server is kept running is read from the host again, so it goes once the user fixed it there. */
import type { MachineView } from '../../../shared/machines/machine-view'
import { reportSealServiceOutcome } from '../../managed-server/service/seal-service-policy'
import { readSealServiceState } from '../../managed-server/service/seal-service-removal'
import { readOwnServerService } from './own-server-service'
import { latestSealServiceOutcome } from './machine-server-install-activity'
import { connectedSshSession } from './machine-ssh-session'

// Every listing of the machines asks; the host is asked at most this often.
const RECHECK_INTERVAL_MS = 15_000

const lastAsked = new Map<string, number>()

function warnsAboutService(view: MachineView): boolean {
  if (view.connection !== 'server') {
    return false
  }
  return (
    view.serverLingerOff === true ||
    (view.serverInstall?.state === 'installed' &&
      view.serverInstall.manager === 'pm2' &&
      view.serverStartsAtBoot === false)
  )
}

export function recheckServerServiceWarnings(views: readonly MachineView[]): void {
  const now = Date.now()
  for (const view of views) {
    const sshTargetId = view.ssh?.targetId
    if (
      !sshTargetId ||
      !warnsAboutService(view) ||
      now - (lastAsked.get(sshTargetId) ?? 0) < RECHECK_INTERVAL_MS
    ) {
      continue
    }
    const session = connectedSshSession(sshTargetId)
    if (!session) {
      continue
    }
    lastAsked.set(sshTargetId, now)
    // A server the user runs has no Seal install to probe; its own CLI answers.
    const reread =
      view.serverInstall?.state === 'installed'
        ? readSealServiceState(session)
        : readOwnServerService(session)
    void reread
      .then((state) => {
        const known = latestSealServiceOutcome(sshTargetId)
        if (
          state &&
          (state.manager !== known?.manager ||
            // A host that does not say whether linger is on has not changed its answer.
            (state.linger !== undefined && state.linger !== known.linger) ||
            state.startsAtBoot !== known.startsAtBoot)
        ) {
          reportSealServiceOutcome(sshTargetId, state)
        }
      })
      .catch((error: unknown) => {
        console.info(
          '[machines] could not read again how the Seal server is kept running:',
          error instanceof Error ? error.message : error
        )
      })
  }
}
