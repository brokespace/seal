import type { Translate } from '@/i18n/use-translate'
import type { MachineServerInstall } from '../../../../../shared/machines/machine-record'
import type { MachineView } from '../../../../../shared/machines/machine-view'

type InstallFailure = Pick<MachineView, 'serverInstall' | 'serverMoveBlocked'>

/** Why the machine is on plain SSH; the reason is the host's own words, so its full stop is dropped. */
export function serverInstallFailureText(t: Translate, view: InstallFailure): string {
  if (view.serverMoveBlocked) {
    return t(
      'w7.notice.moveBlocked',
      'Seal server is not installed: some saved items cannot move to the server.'
    )
  }
  const reason = view.serverInstall?.reason?.trim().replace(/[.\s]+$/, '')
  return reason
    ? t('w7.notice.failed', 'Seal server is not installed: {{reason}}.', { reason })
    : t('w7.notice.failedNoReason', 'Seal server is not installed.')
}

/** How an installed server is kept running, in words. */
export function serverManagerText(t: Translate, manager: MachineServerInstall['manager']): string {
  switch (manager) {
    case 'systemd-user':
      return t('w7.server.systemd', 'Runs as a system service (systemd)')
    case 'launchd':
      return t('w7.server.launchd', 'Runs as a system service (launchd)')
    case 'pm2':
      return t('w7.server.pm2', 'Kept running by PM2')
    case 'detached':
      return t('w7.server.detached', 'Starts when Seal connects and stops when idle')
    case undefined:
      return t('w7.server.installed', 'Installed on this machine')
  }
}
