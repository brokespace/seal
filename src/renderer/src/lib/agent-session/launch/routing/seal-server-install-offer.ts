import { toast } from 'sonner'
import { translate as t } from '@/i18n/i18n'
import { rememberMachineSelection } from '@/components/machines/model/machine-selection'
import { readIpcErrorMessage } from '@/runtime/errors/ipc-error'
import { useAppStore } from '@/store/index'
import { parseExecutionHostId } from '../../../../../../shared/execution-host'
import type { MachineId } from '../../../../../../shared/machines/machine-types'

/** The machines API with the install entry point, which is absent until the server install ships. */
type MachinesApiWithServerInstall = NonNullable<typeof window.api.machines> & {
  installServer?: (args: { machineId: MachineId }) => Promise<unknown>
}

async function installSealServerOnSshTarget(sshTargetId: string): Promise<void> {
  const machines: MachinesApiWithServerInstall | undefined = window.api.machines
  const machine = await machines
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
    return
  }
  if (typeof machines?.installServer !== 'function') {
    return
  }
  try {
    await machines.installServer({ machineId: machine.id })
  } catch (error) {
    toast.error(
      t('seal.launcher.installServerFailed', 'Could not install Seal server on {{value0}}', {
        value0: machine.name
      }),
      { description: readIpcErrorMessage(error) }
    )
  }
}

/**
 * Starts the Seal server install for the SSH machine behind an execution host, where chats run
 * through that server, and shows that machine. False when the host is not an SSH machine.
 */
export function offerSealServerInstall(executionHostId: string | undefined): boolean {
  const host = parseExecutionHostId(executionHostId)
  if (host?.kind !== 'ssh') {
    return false
  }
  void installSealServerOnSshTarget(host.targetId)
  return true
}
