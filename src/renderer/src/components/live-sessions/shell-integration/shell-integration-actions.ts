import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type {
  ShellIntegrationAction,
  ShellIntegrationStatus
} from '../../../../../shared/shell-integration/shell-integration-installer'

export const LOCAL_SHELL_HOST_ID = 'local'

function successMessage(action: ShellIntegrationAction, status: ShellIntegrationStatus): string {
  if (action === 'uninstall') {
    return translate(
      'auto.components.live-sessions.shell-integration.removed',
      'Shell integration removed. Open a new shell for it to take effect.'
    )
  }
  if (!status.tmux) {
    return translate(
      'auto.components.live-sessions.shell-integration.installedNoTmux',
      'Shell integration installed, but tmux 3.0+ is missing there, so claude and codex still run unwrapped.'
    )
  }
  return translate(
    'auto.components.live-sessions.shell-integration.installed',
    'Shell integration installed. Open a new shell, then start claude or codex as usual.'
  )
}

/** Runs one install step on a host and reports the outcome as a toast. */
export async function runShellIntegrationAction(
  hostId: string,
  action: 'install' | 'uninstall'
): Promise<ShellIntegrationStatus | null> {
  try {
    const status = await window.api.liveSessions.shellIntegration({ hostId, action })
    toast.success(successMessage(action, status))
    return status
  } catch (error) {
    toast.error(
      translate(
        'auto.components.live-sessions.shell-integration.failed',
        'Shell integration failed: {{reason}}',
        { reason: error instanceof Error ? error.message : String(error) }
      )
    )
    return null
  }
}
