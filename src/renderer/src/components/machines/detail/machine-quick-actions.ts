import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { translate as t } from '@/i18n/i18n'
import { revealFloatingWorkspacePanel } from '@/components/floating-terminal/floating-workspace-panel-reveal'
import { createFloatingWorkspaceTerminalTab } from '@/components/floating-terminal/floating-workspace-tab-creation'
import { showPlainSshPanel } from '@/ssh/plain-ssh-terminal-panels'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** SSH shells open in a plain terminal panel so they never wait on a workspace or runtime. */
export function openMachineTerminal(machine: MachineSummary): void {
  if (machine.kind === 'local') {
    const state = useAppStore.getState()
    if (revealFloatingWorkspacePanel(state)) {
      void createFloatingWorkspaceTerminalTab(useAppStore.getState()).catch((error: unknown) =>
        toast.error(errorText(error))
      )
    }
    return
  }
  if (machine.sshTargetId) {
    showPlainSshPanel(machine.sshTargetId, machine.label, 'machine-shell')
    return
  }
  toast.message(
    t(
      'auto.components.machines.actions.runtimeTerminal',
      'Open a workspace on this runtime to start a terminal there.'
    )
  )
}

export async function openMachineInEditor(machine: MachineSummary, path: string): Promise<void> {
  if (machine.kind === 'runtime') {
    return
  }
  try {
    const result = await window.api.shell.openInExternalEditor({
      path,
      builtInEditorId: 'vscode',
      connectionId: machine.sshTargetId,
      ownerHostId: machine.id
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
  if (!machine.sshTargetId) {
    return
  }
  try {
    if (machine.status === 'error') {
      await window.api.ssh.disconnect({ targetId: machine.sshTargetId }).catch(() => {})
    }
    await window.api.ssh.connect({ targetId: machine.sshTargetId })
  } catch (error) {
    toast.error(errorText(error))
  }
}
