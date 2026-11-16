import React, { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { AddRemoteHostDialog } from '@/components/sidebar/host-admission/ssh/AddRemoteHostDialog'
import type { MachineConnectionType } from '../../../../../shared/machines/machine-record'
import type { MachineId } from '../../../../../shared/machines/machine-types'
import { readIpcErrorMessage } from '@/runtime/errors/ipc-error'
import { installSealServerOnMachine } from '../server-install/seal-server-install-requests'
import {
  AddMachineServerInstallOptions,
  DEFAULT_SERVER_INSTALL_CHOICE
} from './AddMachineServerInstallOptions'

/** `machineId` adds the other transport to an existing machine (stored, not switched to). */
export type AddMachineRequest = {
  mode: MachineConnectionType
  machineId: MachineId | null
  /** The connection an existing machine keeps. */
  keepConnection?: MachineConnectionType
}

export function AddMachineMenu({
  onPick
}: {
  onPick: (mode: MachineConnectionType) => void
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Plus />
          {t('auto.components.settings.machines.add', 'Add machine')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onPick('ssh')}>
          {t('auto.components.settings.machines.addOverSsh', 'Connect over SSH…')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onPick('server')}>
          {t(
            'auto.components.settings.machines.addViaServer',
            'Connect via Seal server (pairing link)…'
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Saves SSH details or a pairing link, then binds it to a machine with the chosen connection. */
export function AddMachineDialog({
  request,
  onClose,
  onAdopted
}: {
  request: AddMachineRequest | null
  onClose: () => void
  onAdopted: () => void
}): React.JSX.Element {
  const [serverChoice, setServerChoice] = useState(DEFAULT_SERVER_INSTALL_CHOICE)
  // Saving takes a moment, so adoption reads the choice as it is then, not as it was on the click.
  const serverChoiceRef = useRef(serverChoice)
  useEffect(() => {
    serverChoiceRef.current = serverChoice
  }, [serverChoice])
  const [shownRequest, setShownRequest] = useState(request)
  if (request !== shownRequest) {
    setShownRequest(request)
    if (request) {
      setServerChoice(DEFAULT_SERVER_INSTALL_CHOICE)
    }
  }
  // Only a new machine is asked: SSH details added to an existing machine change nothing on it.
  const offersServerInstall = request?.mode === 'ssh' && request.machineId === null
  return (
    <AddRemoteHostDialog
      mode={request?.mode ?? null}
      onOpenChange={(mode) => {
        if (mode === null) {
          onClose()
        }
      }}
      sshFormOptions={
        offersServerInstall ? (
          <AddMachineServerInstallOptions choice={serverChoice} onChange={setServerChoice} />
        ) : undefined
      }
      onAdded={(added) => {
        if (!request) {
          return
        }
        const choice = offersServerInstall ? serverChoiceRef.current : null
        window.api.machines
          ?.adopt({
            ...added,
            connection: request.keepConnection ?? request.mode,
            ...(request.machineId ? { machineId: request.machineId } : {}),
            ...(choice?.install
              ? { serverInstall: 'auto' as const, serviceManager: choice.manager }
              : choice
                ? { serverInstall: 'never' as const }
                : {})
          })
          .then((machine) => {
            onAdopted()
            if (choice?.install) {
              // The dialog is closed by now; the machine's page shows the install and how it ends.
              void installSealServerOnMachine(machine.id, { manager: choice.manager }).then(
                onAdopted,
                () => {}
              )
            }
          })
          .catch((error: unknown) => toast.error(readIpcErrorMessage(error) ?? String(error)))
      }}
    />
  )
}
