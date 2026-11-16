import React from 'react'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import type { MachineView } from '../../../../../shared/machines/machine-view'
import {
  serverInstallFailureText,
  serverInstallIsRunning,
  serverInstallWaitsForHostText
} from '../server-install/seal-server-install-copy'
import { MACHINE_BADGE_CLASS } from './MachineConnectionBadge'

/**
 * Marks the machines whose Seal server is being installed or needs a decision: a failed install,
 * or the one-time offer. A machine that runs its own server gets none: nothing is to be installed.
 */
export function MachineServerInstallBadge({
  view,
  connecting
}: {
  view: MachineView | undefined
  connecting: boolean
}): React.JSX.Element | null {
  const t = useTranslate()
  if (!view) {
    return null
  }
  if (serverInstallIsRunning(view, connecting)) {
    return view.serverInstallWaitsForHost ? (
      <span
        className={MACHINE_BADGE_CLASS}
        title={serverInstallWaitsForHostText(t)}
        data-machine-server-badge="waiting-for-host"
      >
        {t('seal.machineServer.list.waitsForHost', 'Waiting for other install')}
      </span>
    ) : (
      <span
        className={MACHINE_BADGE_CLASS}
        title={t(
          'seal.machineServer.list.installingTitle',
          'Seal server is being installed on this machine'
        )}
        data-machine-server-badge="installing"
      >
        {t('seal.machineServer.list.installing', 'Installing')}
      </span>
    )
  }
  if (view.serverInstallAction === 'retry') {
    return (
      <span
        className={cn(MACHINE_BADGE_CLASS, 'border-status-warning-border text-status-warning-text')}
        title={serverInstallFailureText(t, view)}
        data-machine-server-badge="retry"
      >
        {view.serverInstall?.state === 'pending'
          ? t('seal.machineServer.list.waiting', 'Install waiting')
          : t('seal.machineServer.list.failed', 'Install failed')}
      </span>
    )
  }
  if (view.serverInstallAction === 'offer') {
    return (
      <span
        className={MACHINE_BADGE_CLASS}
        title={t(
          'seal.machineServer.list.offerTitle',
          'Seal server can be installed on this machine'
        )}
        data-machine-server-badge="offer"
      >
        {t('seal.machineServer.list.offer', 'Install available')}
      </span>
    )
  }
  return null
}
