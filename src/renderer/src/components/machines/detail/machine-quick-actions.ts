import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { translate as t } from '@/i18n/i18n'
import { revealFloatingWorkspacePanel } from '@/components/floating-terminal/floating-workspace-panel-reveal'
import { createFloatingWorkspaceTerminalTab } from '@/components/floating-terminal/floating-workspace-tab-creation'
import { showMachineTerminalPanel } from '@/ssh/plain-ssh-terminal-panels'
import { toSshExecutionHostId } from '../../../../../shared/execution-host'
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

export function launchMachineAgent(
  machine: MachineSummary,
  agent: string,
  options: { cwd?: string; prompt?: string } = {}
): void {
  showMachineTerminalPanel(machine.label, {
    machineId: machine.id,
    agent,
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.prompt ? { prompt: options.prompt } : {})
  })
}

/** VS Code dials the stored SSH details itself, whichever transport Seal is using. */
export async function openMachineInEditor(machine: MachineSummary, path: string): Promise<void> {
  if (machine.connection !== 'local' && !machine.sshTargetId) {
    toast.message(
      t(
        'auto.components.machines.actions.editorNeedsSsh',
        'Add SSH details to this machine to open it in VS Code. You can edit its files here under Files.'
      )
    )
    return
  }
  try {
    const result = await window.api.shell.openInExternalEditor({
      path,
      builtInEditorId: 'vscode',
      connectionId: machine.sshTargetId,
      ownerHostId: machine.sshTargetId ? toSshExecutionHostId(machine.sshTargetId) : 'local'
    })
    if (!result.ok) {
      toast.error(
        result.reason === 'ssh-alias-required'
          ? t(
              'auto.components.machines.actions.editorAlias',
              'Add {{host}} to your SSH config to open it in an editor.',
              { host: result.host }
            )
          : t(
              'auto.components.machines.actions.editorFailed',
              'Could not open the editor ({{reason}}).',
              {
                reason: result.reason
              }
            )
      )
    }
  } catch (error) {
    toast.error(errorText(error))
  }
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
