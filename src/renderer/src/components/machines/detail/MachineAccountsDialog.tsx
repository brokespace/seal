import { useTranslate } from '@/i18n/use-translate'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import { SealAccountsPage, sealFleetMachineId } from '../../settings/seal-accounts/SealAccountsPage'

const LOCAL_TARGET = { kind: 'local' } as const

/** One machine's Claude and Codex accounts, the rules that choose among them, and its sessions. */
export function MachineAccountsDialog({
  machine,
  open,
  onOpenChange
}: {
  machine: MachineSummary
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const t = useTranslate()
  const machineId = sealFleetMachineId(machine)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[85vh] flex-col sm:max-w-3xl"
        data-slot="machine-accounts-dialog"
      >
        <DialogHeader>
          <DialogTitle>
            {t('auto.components.machines.detail.accountsTitle', 'Accounts on {{value0}}', {
              value0: machine.label
            })}
          </DialogTitle>
          <DialogDescription>
            {t(
              'auto.components.machines.detail.accountsDescription',
              'The Claude and Codex logins signed in on this machine, and which one its new sessions use.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="scrollbar-sleek -mx-6 min-h-0 overflow-y-auto px-6">
          {open && machineId ? (
            <SealAccountsPage target={LOCAL_TARGET} machineId={machineId} />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
