import { toast } from 'sonner'
import { translate as t } from '@/i18n/i18n'
import { rememberMachineSelection } from '@/components/machines/model/machine-selection'
import { useAppStore } from '@/store/index'
import { parseExecutionHostId } from '../../../../../../shared/execution-host'

async function showSshMachine(sshTargetId: string): Promise<void> {
  const machine = await window.api.machines
    ?.list()
    .then((views) => views.find((view) => view.ssh?.targetId === sshTargetId))
    .catch(() => undefined)
  if (machine) {
    // Before the page opens: it reads the remembered machine only when it mounts.
    rememberMachineSelection(machine.id)
  }
  useAppStore.getState().openMachinesPage()
  if (!machine) {
    toast.error(
      t(
        'seal.launcher.installServerMachineMissing',
        'This SSH host is not in Machines. Add it there to install Seal server.'
      )
    )
  }
}

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
  void showSshMachine(host.targetId)
  return true
}
