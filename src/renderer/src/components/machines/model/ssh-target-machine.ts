import { toast } from 'sonner'
import { translate as t } from '@/i18n/i18n'
import { useAppStore } from '@/store/index'
import type { MachineView } from '../../../../../shared/machines/machine-view'
import { rememberMachineSelection } from './machine-selection'

/** The machine that holds an SSH host's details. */
export function machineOfSshTarget(
  views: readonly MachineView[],
  sshTargetId: string
): MachineView | undefined {
  return views.find((view) => view.ssh?.targetId === sshTargetId)
}

/** Undefined when the host is not in Machines or the machines cannot be read. */
export async function findSshTargetMachine(sshTargetId: string): Promise<MachineView | undefined> {
  const views = await window.api.machines?.list().catch(() => undefined)
  return views ? machineOfSshTarget(views, sshTargetId) : undefined
}

/** Opens the Machines page on the machine behind an SSH host, where its Seal server is decided. */
export async function showSshTargetMachine(sshTargetId: string): Promise<void> {
  const machine = await findSshTargetMachine(sshTargetId)
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
