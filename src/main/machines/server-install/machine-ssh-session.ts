/** The app's SSH session to a machine, for work Seal does on the host itself. */
import type { SshConnection } from '../../ssh/connection/ssh-connection'
import {
  connectRegisteredSshTarget,
  getSshConnectionManager
} from '../../ssh/targets/ssh-target-registry'
import { whileSshConnectsDirectly } from './machine-server-install-activity'

export function connectedSshSession(sshTargetId: string): SshConnection | null {
  const manager = getSshConnectionManager()
  return manager?.getState(sshTargetId)?.status === 'connected'
    ? (manager.getConnection(sshTargetId) ?? null)
    : null
}

export async function sshSessionTo(sshTargetId: string): Promise<SshConnection> {
  const open = connectedSshSession(sshTargetId)
  if (open) {
    return open
  }
  await connectRegisteredSshTarget(sshTargetId)
  const connected = connectedSshSession(sshTargetId)
  if (!connected) {
    throw new Error('Seal could not reach this machine over SSH')
  }
  return connected
}

/**
 * Runs `work` on the machine's SSH session. One opened for it deploys nothing on the host and is
 * closed afterwards, unless `keepsOpened` says the result still needs it; an open one always stays.
 */
export async function onPlainSshSession<T>(
  sshTargetId: string,
  work: (session: SshConnection) => Promise<T>,
  keepsOpened: (result: T) => boolean = () => false
): Promise<T> {
  const open = connectedSshSession(sshTargetId)
  const session =
    open ?? (await whileSshConnectsDirectly(sshTargetId, () => sshSessionTo(sshTargetId)))
  let keep = open !== null
  try {
    const result = await work(session)
    keep ||= keepsOpened(result)
    return result
  } finally {
    if (!keep) {
      await closeSshSession(sshTargetId)
    }
  }
}

async function closeSshSession(sshTargetId: string): Promise<void> {
  try {
    // Import lazily: the SSH teardown wires the whole SSH stack, and only this one-off needs it.
    const { disconnectRegisteredSshTarget } = await import('../../ipc/ssh/ssh-session-teardown')
    await disconnectRegisteredSshTarget(sshTargetId)
  } catch (error) {
    console.warn('[machines] could not close an SSH session opened for work on a machine:', error)
  }
}
