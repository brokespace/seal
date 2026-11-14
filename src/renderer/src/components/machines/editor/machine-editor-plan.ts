import { isRemoteSshEditorCommand } from '../../../../../shared/remote-ssh-editor-launcher'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import type { OpenInApplication } from '../../../../../shared/ui-chrome-types'

type EditorMachine = Pick<MachineSummary, 'connection' | 'sshTargetId'>

export type MachineBuiltInEditorReason =
  /** Reached through its Seal server only, so no app on this computer can dial it. */
  | 'no-ssh-details'
  /** SSH details exist, but none of the user's Open In apps can open a path over SSH. */
  | 'no-remote-editor'
  /** The user removed every Open In app. */
  | 'no-apps'

export type MachineEditorPlan =
  | {
      kind: 'external'
      application: OpenInApplication
      /** The stored SSH details the app dials itself; null on this computer. */
      sshTargetId: string | null
    }
  | { kind: 'built-in'; reason: MachineBuiltInEditorReason }

/** The user's Open In apps that can reach this machine's files, in their saved order. */
export function listMachineEditorApplications(
  machine: EditorMachine,
  applications: readonly OpenInApplication[]
): OpenInApplication[] {
  if (machine.connection === 'local') {
    return [...applications]
  }
  if (!machine.sshTargetId) {
    return []
  }
  return applications.filter((application) => isRemoteSshEditorCommand(application.command))
}

/**
 * Where "Open in editor" goes. An app on this computer reaches a remote machine only over SSH,
 * whichever transport Seal itself uses, so anything else opens in Seal's own editor.
 */
export function planMachineEditorOpen(
  machine: EditorMachine,
  applications: readonly OpenInApplication[],
  applicationId?: string
): MachineEditorPlan {
  const usable = listMachineEditorApplications(machine, applications)
  const application = usable.find((entry) => entry.id === applicationId) ?? usable[0]
  if (application) {
    return {
      kind: 'external',
      application,
      sshTargetId: machine.connection === 'local' ? null : machine.sshTargetId
    }
  }
  if (machine.connection !== 'local' && !machine.sshTargetId) {
    return { kind: 'built-in', reason: 'no-ssh-details' }
  }
  return { kind: 'built-in', reason: applications.length === 0 ? 'no-apps' : 'no-remote-editor' }
}
