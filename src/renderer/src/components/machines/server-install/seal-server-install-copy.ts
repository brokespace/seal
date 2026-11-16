import type { Translate } from '@/i18n/use-translate'
import type { MachineServerInstall } from '../../../../../shared/machines/machine-record'
import type { MachineStatus } from '../../../../../shared/machines/machine-summaries'
import type { MachineView } from '../../../../../shared/machines/machine-view'

type InstallFailure = Pick<MachineView, 'serverInstall' | 'serverMoveBlocked'>

/** Why the machine is on plain SSH; the reason is the host's own words, so its full stop is dropped. */
export function serverInstallFailureText(t: Translate, view: InstallFailure): string {
  if (view.serverMoveBlocked) {
    return t(
      'seal.machineServer.notice.moveBlocked',
      'Seal server is not installed: some saved items cannot move to the server.'
    )
  }
  const reason = view.serverInstall?.reason?.trim().replace(/[.\s]+$/, '')
  return reason
    ? t('seal.machineServer.notice.failed', 'Seal server is not installed: {{reason}}.', { reason })
    : t('seal.machineServer.notice.failedNoReason', 'Seal server is not installed.')
}

/** How an installed server is kept running, in words. */
export function serverManagerText(t: Translate, manager: MachineServerInstall['manager']): string {
  switch (manager) {
    case 'systemd-user':
      return t('seal.machineServer.server.systemd', 'Runs as a systemd user service')
    case 'launchd':
      return t('seal.machineServer.server.launchd', 'Runs as a launchd user service (experimental)')
    case 'pm2':
      return t('seal.machineServer.server.pm2', 'Kept running by PM2')
    case 'detached':
      return t(
        'seal.machineServer.server.detached',
        'Starts when Seal connects and stops when idle'
      )
    case undefined:
      return t('seal.machineServer.server.installed', 'Installed on this machine')
  }
}

type InstallProgress = Pick<
  MachineView,
  'serverInstall' | 'serverInstallAction' | 'serverInstallWaitsForHost'
>

/** A connect runs an install that waited for terminals, so that one counts as running too. */
export function serverInstallIsRunning(view: InstallProgress, connecting: boolean): boolean {
  return (
    view.serverInstallAction === 'installing' ||
    (connecting && view.serverInstallAction === 'retry' && view.serverInstall?.state === 'pending')
  )
}

export function serverInstallWaitsForHostText(t: Translate): string {
  return t(
    'seal.machineServer.server.waitsForHost',
    'Another Seal server install is in progress on this machine. Seal is waiting for it to finish.'
  )
}

/** What a machine's status says while an install runs, where it would only say "Connecting". */
export function serverInstallStatusText(
  t: Translate,
  view: InstallProgress | null | undefined,
  status: MachineStatus
): string | null {
  if (!view || status === 'error' || !serverInstallIsRunning(view, status === 'connecting')) {
    return null
  }
  return view.serverInstallWaitsForHost
    ? t('seal.machineServer.status.waitsForHost', 'Waiting for another install')
    : t('seal.machineServer.status.installing', 'Installing Seal server')
}
