import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { translate as t } from '@/i18n/i18n'
import { revealFloatingWorkspacePanel } from '@/components/floating-terminal/floating-workspace-panel-reveal'
import { createFloatingWorkspaceTerminalTab } from '@/components/floating-terminal/floating-workspace-tab-creation'
import { showMachineTerminalPanel } from '@/ssh/plain-ssh-terminal-panels'
import { openOpenInAppsSettings } from '@/components/sidebar/workspace-actions/open/WorktreeOpenInMenu'
import { showOpenFailureToast } from '@/components/sidebar/workspace-actions/open/worktree-open-failure-toast'
import { toSshExecutionHostId } from '../../../../../shared/execution-host'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import { isRemoteSshEditorCommand } from '../../../../../shared/remote-ssh-editor-launcher'
import type { ShellOpenExternalEditorResult } from '../../../../../shared/shell/opening/shell-open-types'
import type { SshTarget } from '../../../../../shared/ssh-types'
import type { OpenInApplication } from '../../../../../shared/ui-chrome-types'

// Why: these errors carry the fix as an action; the default toast lifetime is too short to read and click.
const ACTIONABLE_TOAST_MS = 15_000

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

export type MachineEditorOpenHandlers = {
  /** Opens the dialog that stores SSH details on a server-only machine. */
  onAddSshDetails: () => void
}

function sshConfigEntry(machine: MachineSummary, target: SshTarget): string {
  const alias = machine.label.trim().replace(/[^A-Za-z0-9._-]+/g, '-') || 'machine'
  const lines = [`Host ${alias}`, `  HostName ${target.host}`, `  Port ${target.port}`]
  if (target.username) {
    lines.push(`  User ${target.username}`)
  }
  if (target.identityFile) {
    lines.push(`  IdentityFile ${target.identityFile}`)
  }
  return `${lines.join('\n')}\n`
}

async function copySshConfigEntry(machine: MachineSummary): Promise<void> {
  try {
    const target = (await window.api.ssh.listTargets()).find(
      (entry) => entry.id === machine.sshTargetId
    )
    if (!target) {
      showOpenFailureToast({ ok: false, reason: 'ssh-target-not-found' }, true, 'path')
      return
    }
    await window.api.ui.writeClipboardText(sshConfigEntry(machine, target))
    toast.success(
      t(
        'auto.components.machines.actions.editorAliasCopied',
        'Copied. Paste it into ~/.ssh/config on this computer, then open the editor again.'
      )
    )
  } catch (error) {
    toast.error(errorText(error))
  }
}

function chooseEditorAction(): { label: string; onClick: () => void } {
  return {
    label: t('auto.components.machines.actions.editorChoose', 'Choose editor'),
    onClick: openOpenInAppsSettings
  }
}

function showMachineEditorFailure(
  machine: MachineSummary,
  application: OpenInApplication,
  result: Exclude<ShellOpenExternalEditorResult, { ok: true }>
): void {
  if (result.reason === 'ssh-alias-required') {
    toast.error(
      t(
        'auto.components.machines.actions.editorAliasTitle',
        '{{app}} needs an SSH config entry for {{machine}}.',
        { app: application.label, machine: machine.label }
      ),
      {
        description: t(
          'auto.components.machines.actions.editorAliasDetail',
          '{{app}} reaches a custom SSH port ({{port}}) only through a Host entry in ~/.ssh/config on this computer.',
          { app: application.label, port: result.port }
        ),
        duration: ACTIONABLE_TOAST_MS,
        action: {
          label: t('auto.components.machines.actions.editorAliasCopy', 'Copy entry'),
          onClick: () => void copySshConfigEntry(machine)
        }
      }
    )
    return
  }
  if (result.reason === 'launch-failed') {
    toast.error(
      t('auto.components.machines.actions.editorLaunchFailed', 'Could not start {{app}}.', {
        app: application.label
      }),
      {
        description: t(
          'auto.components.machines.actions.editorLaunchFailedDetail',
          'Seal could not run the {{command}} command on this computer. Install it from the app, or choose another editor.',
          { command: application.command }
        ),
        duration: ACTIONABLE_TOAST_MS,
        action: chooseEditorAction()
      }
    )
    return
  }
  showOpenFailureToast(result, machine.connection !== 'local', 'path')
}

/** The editor dials the stored SSH details itself, whichever transport Seal is using. */
export async function openMachineInEditor(
  machine: MachineSummary,
  path: string,
  application: OpenInApplication | null,
  handlers: MachineEditorOpenHandlers
): Promise<void> {
  if (!application) {
    toast.error(t('auto.components.machines.actions.editorNone', 'No editor is set up.'), {
      description: t(
        'auto.components.machines.actions.editorNoneDetail',
        'Add VS Code, Cursor, or another editor under Settings, then try again.'
      ),
      duration: ACTIONABLE_TOAST_MS,
      action: chooseEditorAction()
    })
    return
  }
  const remote = machine.connection !== 'local'
  if (remote && !isRemoteSshEditorCommand(application.command)) {
    toast.error(
      t(
        'auto.components.machines.actions.editorLocalOnly',
        '{{app}} cannot open folders on another machine.',
        { app: application.label }
      ),
      {
        description: t(
          'auto.components.machines.actions.editorLocalOnlyDetail',
          'VS Code, Cursor, and Zed can. Add one of them, then try again.'
        ),
        duration: ACTIONABLE_TOAST_MS,
        action: chooseEditorAction()
      }
    )
    return
  }
  if (remote && !machine.sshTargetId) {
    toast.error(
      t(
        'auto.components.machines.actions.editorNeedsSshTitle',
        '{{app}} needs SSH details for {{machine}}.',
        { app: application.label, machine: machine.label }
      ),
      {
        description: t(
          'auto.components.machines.actions.editorNeedsSshDetail',
          'This machine is connected through its Seal server, and an editor on this computer connects over SSH. The server connection stays in use.'
        ),
        duration: ACTIONABLE_TOAST_MS,
        action: {
          label: t('auto.components.machines.actions.editorAddSsh', 'Add SSH details'),
          onClick: handlers.onAddSshDetails
        }
      }
    )
    return
  }
  try {
    const result = await window.api.shell.openInExternalEditor({
      path,
      openInApplicationId: application.id,
      connectionId: machine.sshTargetId,
      ownerHostId: machine.sshTargetId ? toSshExecutionHostId(machine.sshTargetId) : 'local'
    })
    if (!result.ok) {
      showMachineEditorFailure(machine, application, result)
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
