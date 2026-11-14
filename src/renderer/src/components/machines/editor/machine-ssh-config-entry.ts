import { toast } from 'sonner'
import { translate as t } from '@/i18n/i18n'
import { showOpenFailureToast } from '@/components/sidebar/workspace-actions/open/worktree-open-failure-toast'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import type { SshTarget } from '../../../../../shared/ssh-types'

/** The `~/.ssh/config` entry that gives an editor a custom-port machine by alias. */
export function machineSshConfigEntry(
  label: string,
  target: Pick<SshTarget, 'host' | 'port' | 'username' | 'identityFile'>
): string {
  const alias = label.trim().replace(/[^A-Za-z0-9._-]+/g, '-') || 'machine'
  const lines = [`Host ${alias}`, `  HostName ${target.host}`, `  Port ${target.port}`]
  if (target.username) {
    lines.push(`  User ${target.username}`)
  }
  if (target.identityFile) {
    lines.push(`  IdentityFile ${target.identityFile}`)
  }
  return `${lines.join('\n')}\n`
}

export async function copyMachineSshConfigEntry(machine: MachineSummary): Promise<void> {
  try {
    const target = (await window.api.ssh.listTargets()).find(
      (entry) => entry.id === machine.sshTargetId
    )
    if (!target) {
      showOpenFailureToast({ ok: false, reason: 'ssh-target-not-found' }, true, 'path')
      return
    }
    await window.api.ui.writeClipboardText(machineSshConfigEntry(machine.label, target))
    toast.success(
      t(
        'auto.components.machines.actions.editorAliasCopied',
        'Copied. Paste it into ~/.ssh/config on this computer, then open the editor again.'
      )
    )
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error))
  }
}
