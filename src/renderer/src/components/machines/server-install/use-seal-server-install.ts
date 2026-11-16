import { useCallback } from 'react'
import { useConfirmationDialog } from '@/components/confirmation-dialog-context'
import { useTranslate } from '@/i18n/use-translate'
import type { MachineId } from '../../../../../shared/machines/machine-types'
import type {
  MachineServiceManagerChoice,
  MachineView
} from '../../../../../shared/machines/machine-view'
import {
  ownSealServerReuseConfirmation,
  sealServerInstallConfirmation,
  type SealServerInstallPurpose
} from './seal-server-confirmations'
import { reuseOwnSealServer, sealServerRequest } from './seal-server-install-requests'

export type SealServerInstallOptions = {
  manager?: MachineServiceManagerChoice
  /** Go ahead with a move that leaves the listed saved items on this computer. */
  moveAnyway?: boolean
  /** `keep-running`: a server already runs there, and the dialog says it becomes a service. */
  purpose?: SealServerInstallPurpose
  /** The running server is one the user runs, so its own CLI makes it a service. */
  runByUser?: boolean
}

export type SealServerInstall = (
  machine: { id: MachineId; name: string },
  options?: SealServerInstallOptions
) => Promise<MachineView | null>

/** An SSH machine Seal has put no server on: one gets there only through `useSealServerInstall`. */
export function hasNoSealServerYet(
  machine: Pick<MachineView, 'connection' | 'serverInstallAction'>
): boolean {
  // `none` on SSH: Seal's server is installed and the machine was switched back to SSH.
  return machine.connection === 'ssh' && machine.serverInstallAction !== 'none'
}

/**
 * The one way to install Seal server on an SSH machine: the dialog says what gets written there,
 * and the request is sent only when the user confirms. Resolves the machine as the attempt left it
 * (`installed`, or `failed` with the reason while it stays on plain SSH). Resolves null when the
 * user cancelled, or when the request could not run and the error toast said why. Never rejects.
 */
export function useSealServerInstall(): SealServerInstall {
  const confirm = useConfirmationDialog()
  const t = useTranslate()
  return useCallback(
    async (machine, options = {}) => {
      const { manager, moveAnyway } = options
      const confirmed = await confirm(sealServerInstallConfirmation(t, machine.name, options))
      return confirmed
        ? sealServerRequest((api) =>
            api.installServer({ machineId: machine.id, manager, moveAnyway })
          )
        : null
    },
    [confirm, t]
  )
}

export type OwnSealServerReuse = (
  machine: { id: MachineId; name: string },
  /** Runs once the user confirmed, right before the request is sent, so busy states start there. */
  onConfirmed?: () => void
) => Promise<MachineView | null>

/**
 * The one way to connect through the Seal server a machine's user set up there: the dialog says
 * what happens, and the request is sent only when the user confirms. Resolves null when the user
 * cancelled, or when the request could not run and the error toast said why. Never rejects.
 */
export function useOwnSealServerReuse(): OwnSealServerReuse {
  const confirm = useConfirmationDialog()
  const t = useTranslate()
  return useCallback(
    async (machine, onConfirmed) => {
      if (!(await confirm(ownSealServerReuseConfirmation(t, machine.name)))) {
        return null
      }
      onConfirmed?.()
      return reuseOwnSealServer(machine.id)
    },
    [confirm, t]
  )
}
