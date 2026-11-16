import { useCallback } from 'react'
import { useConfirmationDialog } from '@/components/confirmation-dialog-context'
import { useTranslate } from '@/i18n/use-translate'
import type { MachineId } from '../../../../../shared/machines/machine-types'
import type {
  MachineServiceManagerChoice,
  MachineView
} from '../../../../../shared/machines/machine-view'
import {
  sealServerInstallConfirmation,
  type SealServerInstallPurpose
} from './seal-server-confirmations'
import { sealServerRequest } from './seal-server-install-requests'

export type SealServerInstallOptions = {
  manager?: MachineServiceManagerChoice
  /** Go ahead with a move that leaves the listed saved items on this computer. */
  moveAnyway?: boolean
  /** `keep-running`: a server already runs there, and the dialog says it becomes a service. */
  purpose?: SealServerInstallPurpose
}

export type SealServerInstall = (
  machine: { id: MachineId; name: string },
  options?: SealServerInstallOptions
) => Promise<MachineView | null>

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
