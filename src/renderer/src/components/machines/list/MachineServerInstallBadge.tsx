import React from 'react'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import type { MachineView } from '../../../../../shared/machines/machine-view'
import { serverInstallFailureText } from '../server-install/seal-server-install-copy'
import { MACHINE_BADGE_CLASS } from './MachineConnectionBadge'

/** Marks the machines whose Seal server needs a decision: a failed install, or the one-time offer. */
export function MachineServerInstallBadge({
  view
}: {
  view: MachineView | undefined
}): React.JSX.Element | null {
  const t = useTranslate()
  if (view?.serverInstallAction === 'retry') {
    return (
      <span
        className={cn(MACHINE_BADGE_CLASS, 'border-status-warning-border text-status-warning-text')}
        title={serverInstallFailureText(t, view)}
        data-machine-server-badge="retry"
      >
        {view.serverInstall?.state === 'pending'
          ? t('w7.list.waiting', 'Install waiting')
          : t('w7.list.failed', 'Install failed')}
      </span>
    )
  }
  if (view?.serverInstallAction === 'offer') {
    return (
      <span
        className={MACHINE_BADGE_CLASS}
        title={t('w7.list.offerTitle', 'Seal server can be installed on this machine')}
        data-machine-server-badge="offer"
      >
        {t('w7.list.offer', 'Install available')}
      </span>
    )
  }
  return null
}
