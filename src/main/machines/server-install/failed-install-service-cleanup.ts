/** A first install whose server never served must not leave its service: the manager would keep restarting it, at boot too. */
import { removeSealService } from '../../managed-server/service/seal-service-removal'
import { sleep } from '../../ssh/connection/ssh-connection-timing'
import { noteSealServiceOutcome } from './machine-server-install-activity'
import { connectedSshSession } from './machine-ssh-session'

const SESSION_POLL_MS = 250
// The plain SSH connect that follows a failed install is up well within this.
const SESSION_WAIT_MS = 30_000

const cleanups = new Map<string, Promise<void>>()

async function sessionAfterFallback(
  sshTargetId: string
): Promise<ReturnType<typeof connectedSshSession>> {
  const deadline = Date.now() + SESSION_WAIT_MS
  for (;;) {
    const session = connectedSshSession(sshTargetId)
    if (session || Date.now() >= deadline) {
      return session
    }
    await sleep(SESSION_POLL_MS)
  }
}

async function removeService(sshTargetId: string): Promise<void> {
  const session = await sessionAfterFallback(sshTargetId)
  if (!session) {
    return
  }
  // A host whose server was activated keeps its service: another desktop may be using it.
  await removeSealService(session, { unlessActivated: true })
  noteSealServiceOutcome(sshTargetId, null)
}

export function removeServiceOfFailedInstall(sshTargetId: string): void {
  if (cleanups.has(sshTargetId)) {
    return
  }
  const cleanup = removeService(sshTargetId)
    .catch((error: unknown) => {
      console.warn(
        '[machines] could not remove the service of a Seal server that did not start:',
        error instanceof Error ? error.message : error
      )
    })
    .finally(() => cleanups.delete(sshTargetId))
  cleanups.set(sshTargetId, cleanup)
}

/** Resolves once no cleanup runs, so a retry never launches through a service that is being removed. */
export function failedInstallServiceCleanup(sshTargetId: string): Promise<void> {
  return cleanups.get(sshTargetId) ?? Promise.resolve()
}
