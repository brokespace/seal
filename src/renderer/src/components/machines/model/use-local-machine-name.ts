import { useCallback } from 'react'
import { useTranslate } from '@/i18n/use-translate'
import type { LiveSessionMachine } from '../../../../../shared/live-sessions/live-session-types'

/** What every surface calls this computer. */
export function useLocalMachineName(): string {
  const t = useTranslate()
  return t('auto.components.machines.page.localName', 'This computer')
}

/** A machine's name where its sessions are listed: the one the Machines tab shows. */
export function useSessionMachineName(): (
  machine: Pick<LiveSessionMachine, 'kind' | 'label'>
) => string {
  const local = useLocalMachineName()
  return useCallback((machine) => (machine.kind === 'local' ? local : machine.label), [local])
}
