/** The app's SSH session to a machine, for work Seal does on the host itself. */
import type { SshConnection } from '../../ssh/connection/ssh-connection'
import {
  connectRegisteredSshTarget,
  getSshConnectionManager
} from '../../ssh/targets/ssh-target-registry'

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
