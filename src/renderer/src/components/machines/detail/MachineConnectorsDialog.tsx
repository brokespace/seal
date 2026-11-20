import { useTranslate } from '@/i18n/use-translate'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import { sealFleetMachineId } from '../../settings/seal-accounts/SealAccountsPage'
import { MachineConnectorsSection } from '../../settings/seal-connectors/ConnectorsHere'

/** The connectors one machine's agents get, and whether its copy of each sign-in is current. */
export function MachineConnectorsDialog({
  machine,
  open,
  onOpenChange
}: {
  machine: MachineSummary
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[85vh] flex-col sm:max-w-3xl"
        data-slot="machine-connectors-dialog"
      >
        <DialogHeader>
          <DialogTitle>
            {t('auto.components.machines.detail.connectorsTitle', 'Connectors on {{value0}}', {
              value0: machine.label
            })}
          </DialogTitle>
          <DialogDescription>
            {t(
              'auto.components.machines.detail.connectorsDescription',
              "The connectors agents on this machine get, and whether this machine's copy of each sign-in is current."
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="scrollbar-sleek -mx-6 min-h-0 overflow-y-auto px-6">
          {open ? (
            <MachineConnectorsSection
              machineKeys={[sealFleetMachineId(machine) ?? machine.id, machine.id]}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
