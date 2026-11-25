import { showSshTargetMachine } from '@/components/machines/model/ssh-target-machine'
import { parseExecutionHostId } from '../../../../../../shared/execution-host'

/**
 * Shows the SSH machine behind an execution host, where chats run through the Seal server.
 * Installing is that machine page's decision: a launcher click never installs anything on a
 * remote machine. False when the host is not an SSH machine.
 */
export function offerSealServerInstall(executionHostId: string | undefined): boolean {
  const host = parseExecutionHostId(executionHostId)
  if (host?.kind !== 'ssh') {
    return false
  }
  void showSshTargetMachine(host.targetId)
  return true
}
