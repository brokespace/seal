import React, { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useMountedRef } from '@/hooks/useMountedRef'
import { useTranslate } from '@/i18n/use-translate'
import { readIpcErrorMessage } from '@/runtime/errors/ipc-error'
import type { MachineView } from '../../../../../shared/machines/machine-view'
import { removeSealServerFromMachine } from './seal-server-install-requests'

/** Nothing is removed until this is confirmed; a failure stays in the dialog to be read. */
export function MachineServerRemoveDialog({
  view,
  open,
  onOpenChange,
  onRemoved
}: {
  view: Pick<MachineView, 'id' | 'name'>
  open: boolean
  onOpenChange: (open: boolean) => void
  onRemoved: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const mountedRef = useMountedRef()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const setOpen = (next: boolean): void => {
    setError(null)
    onOpenChange(next)
  }
  const remove = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await removeSealServerFromMachine(view.id)
      if (mountedRef.current) {
        setOpen(false)
      }
      onRemoved()
    } catch (cause) {
      if (mountedRef.current) {
        setError(readIpcErrorMessage(cause) ?? String(cause))
      }
    } finally {
      if (mountedRef.current) {
        setBusy(false)
      }
    }
  }
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && setOpen(false)}>
      <DialogContent surface="security" className="sm:max-w-md" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>
            {t('w7.remove.title', 'Remove Seal server from {{name}}?', { name: view.name })}
          </DialogTitle>
          <DialogDescription>
            {t(
              'w7.remove.description',
              'This removes the service and the server from the machine. {{name}} goes back to a plain SSH connection, and agents and terminals running through the server stop.',
              { name: view.name }
            )}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-xs text-destructive [overflow-wrap:anywhere]" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
            {t('auto.components.machines.delete.cancel', 'Cancel')}
          </Button>
          <Button type="button" variant="destructive" disabled={busy} onClick={() => void remove()}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            {t('w7.remove.confirm', 'Remove Seal server')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
