import React from 'react'
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
  return (
    <AddRemoteHostDialog
      mode={request?.mode ?? null}
      onOpenChange={(mode) => {
        if (mode === null) {
          onClose()
        }
      }}
      onAdded={(added) => {
        if (!request) {
          return
        }
        window.api.machines
          ?.adopt({
            ...added,
            connection: request.keepConnection ?? request.mode,
            ...(request.machineId ? { machineId: request.machineId } : {})
          })
          .then(onAdopted)
          .catch((error: unknown) =>
            toast.error(error instanceof Error ? error.message : String(error))
          )
      }}
    />
  )
}
