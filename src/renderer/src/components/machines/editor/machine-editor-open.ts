import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { translate as t } from '@/i18n/i18n'
import { NO_OPEN_IN_APPLICATIONS } from '@/lib/files/os-open/open-in-application-selection'
import { openOpenInAppsSettings } from '@/components/sidebar/workspace-actions/open/WorktreeOpenInMenu'
import { showOpenFailureToast } from '@/components/sidebar/workspace-actions/open/worktree-open-failure-toast'
import { LOCAL_EXECUTION_HOST_ID, toSshExecutionHostId } from '../../../../../shared/execution-host'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import type {
  ShellEditorLaunchFailure,
  ShellOpenExternalEditorResult
} from '../../../../../shared/shell/opening/shell-open-types'
import type { OpenInApplication } from '../../../../../shared/ui-chrome-types'
import { planMachineEditorOpen, type MachineBuiltInEditorReason } from './machine-editor-plan'
import { copyMachineSshConfigEntry } from './machine-ssh-config-entry'

// These toasts carry the fix as an action; the default lifetime is too short to read and click.
const ACTIONABLE_TOAST_MS = 15_000

export type MachineEditorTarget = { path: string; kind: 'file' | 'folder' }

export type MachineEditorHost = {
  /** Shows the path in Seal's own editor: the file's editor, or the folder in the file browser. */
  openBuiltIn: (target: MachineEditorTarget) => void
  /** Starts adding SSH details to this machine. */
  addSshDetails: () => void
}

type ToastAction = { label: string; onClick: () => void }

function customizeAppsAction(): ToastAction {
  return {
    label: t('auto.components.machines.editor.customizeApps', 'Choose apps…'),
    onClick: openOpenInAppsSettings
  }
}

function openedInSealTitle(target: MachineEditorTarget): string {
  return target.kind === 'file'
    ? t('auto.components.machines.editor.openedFileInSeal', 'Opened the file in Seal’s editor')
    : t('auto.components.machines.editor.openedFolderInSeal', 'Showing the folder in Seal’s files')
}

function announceBuiltIn(
  machine: MachineSummary,
  target: MachineEditorTarget,
  reason: MachineBuiltInEditorReason,
  host: MachineEditorHost
): void {
  if (reason === 'no-ssh-details') {
    toast.message(openedInSealTitle(target), {
      description: t(
        'auto.components.machines.editor.noSshDetails',
        '{{machine}} is reached through its Seal server only. Add SSH details to open it in VS Code, Cursor, or Zed on this computer.',
        { machine: machine.label }
      ),
      duration: ACTIONABLE_TOAST_MS,
      action: {
        label: t('auto.components.machines.detail.addSsh', 'Add SSH details…'),
        onClick: host.addSshDetails
      }
    })
    return
  }
  toast.message(openedInSealTitle(target), {
    description:
      reason === 'no-apps'
        ? t(
            'auto.components.machines.editor.noApps',
            'No Open In apps are set up. Add one to open paths in another editor.'
          )
        : t(
            'auto.components.machines.editor.noRemoteEditor',
            'None of your Open In apps can open a remote machine. Add VS Code, Cursor, or Zed.'
          ),
    duration: ACTIONABLE_TOAST_MS,
    action: customizeAppsAction()
  })
}

function launchFailureDetail(failure: ShellEditorLaunchFailure): string {
  switch (failure.kind) {
    case 'not-found':
      return t(
        'auto.components.machines.editor.commandNotFound',
        'The “{{command}}” command was not found on this computer. Install the app’s command-line launcher, or choose another app.',
        { command: failure.command }
      )
    case 'not-executable':
      return t(
        'auto.components.machines.editor.commandNotExecutable',
        '“{{command}}” is not allowed to run on this computer.',
        { command: failure.command }
      )
    case 'exited':
      return t(
        'auto.components.machines.editor.commandExited',
        '“{{command}}” quit with exit code {{exitCode}} before opening anything.',
        { command: failure.command, exitCode: failure.exitCode }
      )
    case 'error':
      return t(
        'auto.components.machines.editor.commandError',
        '“{{command}}” could not start: {{message}}',
        { command: failure.command, message: failure.message }
      )
  }
}

function reportFailure(
  result: Exclude<ShellOpenExternalEditorResult, { ok: true }>,
  application: OpenInApplication,
  machine: MachineSummary,
  target: MachineEditorTarget,
  host: MachineEditorHost
): void {
  const openInSeal: ToastAction = {
    label: t('auto.components.machines.editor.openInSeal', 'Open in Seal'),
    onClick: () => host.openBuiltIn(target)
  }
  if (result.reason === 'ssh-alias-required') {
    toast.error(
      t(
        'auto.components.machines.editor.aliasRequired',
        '{{app}} needs an SSH config entry for {{machine}}',
        { app: application.label, machine: machine.label }
      ),
      {
        description: t(
          'auto.components.machines.editor.aliasRequiredDetail',
          'It reaches a custom SSH port only through a Host entry for {{host}}:{{port}} in ~/.ssh/config on this computer.',
          { host: result.host, port: result.port }
        ),
        duration: ACTIONABLE_TOAST_MS,
        action: {
          label: t('auto.components.machines.actions.editorAliasCopy', 'Copy entry'),
          onClick: () => void copyMachineSshConfigEntry(machine)
        },
        cancel: openInSeal
      }
    )
    return
  }
  if (result.reason === 'launch-failed') {
    toast.error(
      t('auto.components.machines.editor.launchFailed', 'Could not open {{app}}', {
        app: application.label
      }),
      {
        description: result.launchFailure
          ? launchFailureDetail(result.launchFailure)
          : t(
              'auto.components.machines.editor.launchFailedDetail',
              'Check this app’s command under Open In apps.'
            ),
        duration: ACTIONABLE_TOAST_MS,
        action: result.launchFailure?.kind === 'exited' ? openInSeal : customizeAppsAction()
      }
    )
    return
  }
  showOpenFailureToast(result, machine.connection !== 'local', 'path')
}

/**
 * Opens a machine's file or folder in an editor: one of the user's Open In apps when it can reach
 * the machine, otherwise Seal's own editor. Every outcome that is not the app opening says why.
 */
export async function openMachinePathInEditor(
  machine: MachineSummary,
  target: MachineEditorTarget,
  host: MachineEditorHost,
  applicationId?: string
): Promise<void> {
  const applications =
    useAppStore.getState().settings?.openInApplications ?? NO_OPEN_IN_APPLICATIONS
  const plan = planMachineEditorOpen(machine, applications, applicationId)
  if (plan.kind === 'built-in') {
    host.openBuiltIn(target)
    announceBuiltIn(machine, target, plan.reason, host)
    return
  }
  let result: ShellOpenExternalEditorResult
  try {
    result = await window.api.shell.openInExternalEditor({
      path: target.path,
      openInApplicationId: plan.application.id,
      connectionId: plan.sshTargetId,
      ownerHostId: plan.sshTargetId
        ? toSshExecutionHostId(plan.sshTargetId)
        : LOCAL_EXECUTION_HOST_ID
    })
  } catch (error) {
    toast.error(
      t('auto.components.machines.editor.launchFailed', 'Could not open {{app}}', {
        app: plan.application.label
      }),
      { description: error instanceof Error ? error.message : String(error) }
    )
    return
  }
  if (!result.ok) {
    reportFailure(result, plan.application, machine, target, host)
  }
}
