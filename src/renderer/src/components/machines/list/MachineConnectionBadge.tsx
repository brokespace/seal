import React from 'react'
import { useTranslate } from '@/i18n/use-translate'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'

/** The transport is a detail: a quiet badge, never a different kind of machine. */
export function MachineConnectionBadge({
  connection
}: {
  connection: MachineSummary['connection']
}): React.JSX.Element | null {
  const t = useTranslate()
  if (connection === 'local') {
    return null
  }
  return (
    <span className="shrink-0 rounded border border-border px-1 text-2xs leading-4 text-muted-foreground">
      {connection === 'ssh'
        ? t('auto.components.machines.connection.ssh', 'SSH')
        : t('auto.components.machines.connection.server', 'Seal server')}
    </span>
  )
}
