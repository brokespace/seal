import { useCallback } from 'react'
import { translate } from '@/i18n/i18n'
import { useTranslate } from '@/i18n/use-translate'
import type { LiveSessionMachine } from '../../../../../shared/live-sessions/live-session-types'

/** What every surface calls this computer. */
export function useLocalMachineName(): string {
  const t = useTranslate()
  return t('auto.components.machines.page.localName', 'This computer')
}

type NamedMachine = Pick<LiveSessionMachine, 'kind' | 'label'>

/** The same name outside React, for lists built as data. */
export function sessionMachineName(machine: NamedMachine): string {
  return machine.kind === 'local'
    ? translate('auto.components.machines.page.localName', 'This computer')
    : machine.label
}

/** A machine's name wherever a session shows it: the one the Machines tab shows. */
export function useSessionMachineName(): (machine: NamedMachine) => string {
  const local = useLocalMachineName()
  return useCallback((machine) => (machine.kind === 'local' ? local : machine.label), [local])
}
