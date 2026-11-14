import React, { useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import { machinePathBasename } from '../../../../../shared/machines/machine-paths'

export function MachineDeleteDialog({
  paths,
  machineLabel,
  description,
  onConfirm,
  onClose
}: {
  paths: string[] | null
  machineLabel: string
  /** For deletes that are not permanent. */
  description?: string
  onConfirm: (paths: string[]) => Promise<void>
  onClose: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [seededFor, setSeededFor] = useState<string[] | null>(null)
  if (seededFor !== paths) {
    setSeededFor(paths)
    setBusy(false)
    setError(null)
  }
  const count = paths?.length ?? 0
  const confirm = async (): Promise<void> => {
    if (!paths || busy) {
      return
    }
    setBusy(true)
    try {
      await onConfirm(paths)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }
  return (
    <Dialog open={paths !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {count === 1
              ? t('auto.components.machines.delete.titleOne', 'Delete {{name}}?', {
                  name: machinePathBasename(paths?.[0] ?? '')
                })
              : t('auto.components.machines.delete.titleMany', 'Delete {{count}} items?', {
                  count
                })}
          </DialogTitle>
          <DialogDescription>
            {description ??
              t(
                'auto.components.machines.delete.description',
                'This permanently deletes them from {{machine}}, including everything inside folders. It cannot be undone.',
                { machine: machineLabel }
              )}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-xs text-destructive [overflow-wrap:anywhere]" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('auto.components.machines.delete.cancel', 'Cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={busy}
            onClick={() => void confirm()}
          >
            {busy ? <Loader2 className="animate-spin" /> : null}
            {t('auto.components.machines.delete.confirm', 'Delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
