import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { revealFloatingWorkspacePanel } from '@/components/floating-terminal/floating-workspace-panel-reveal'
import { createFloatingWorkspaceTerminalTab } from '@/components/floating-terminal/floating-workspace-tab-creation'
import { showMachineTerminalPanel } from '@/ssh/plain-ssh-terminal-panels'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Remote shells run over the machine's own connection, so SSH and server machines match. */
export function openMachineTerminal(machine: MachineSummary, cwd?: string): void {
  if (machine.connection === 'local') {
    const state = useAppStore.getState()
    if (revealFloatingWorkspacePanel(state)) {
      void createFloatingWorkspaceTerminalTab(useAppStore.getState()).catch((error: unknown) =>
        toast.error(errorText(error))
      )
    }
    return
  }
  showMachineTerminalPanel(machine.label, { machineId: machine.id, ...(cwd ? { cwd } : {}) })
}

export async function connectMachine(machine: MachineSummary): Promise<void> {
  if (machine.connection === 'local') {
    return
  }
  try {
    if (machine.status === 'error' && machine.connection === 'ssh' && machine.sshTargetId) {
      await window.api.ssh.disconnect({ targetId: machine.sshTargetId }).catch(() => {})
    }
    await window.api.machines?.connect({ machineId: machine.id })
  } catch (error) {
    toast.error(errorText(error))
  }
}

export async function switchMachineConnection(
  machine: MachineSummary,
  connection: 'ssh' | 'server'
): Promise<void> {
  try {
    // One transport at a time: hang up the one being left before dialing the other.
    if (connection === 'ssh' && machine.runtimeEnvironmentId) {
      await window.api.runtimeEnvironments
        ?.disconnect({ selector: machine.runtimeEnvironmentId })
        .catch(() => {})
    } else if (connection === 'server' && machine.sshTargetId) {
      await window.api.ssh.disconnect({ targetId: machine.sshTargetId }).catch(() => {})
    }
    await window.api.machines?.setConnection({ machineId: machine.id, connection })
    await window.api.machines?.connect({ machineId: machine.id })
  } catch (error) {
    toast.error(errorText(error))
  }
}
