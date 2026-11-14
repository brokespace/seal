import React, { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { useTranslate } from '@/i18n/use-translate'
import type {
  MachineCleanupResult,
  MachineCleanupScan
} from '../../../../../shared/machines/machine-resource-types'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import { formatBytes } from '../model/machine-format'
import { machineResourceApi, resourceErrorText } from './machine-resource-requests'
import type { MachineCleanupCopy } from './use-machine-cleanup-copy'

/**
 * Lists exactly what a cleanup removes and removes only what stays ticked. Nothing on the machine
 * changes before the confirm button is pressed.
 */
export function MachineCleanupDialog({
  machine,
  scan,
  copy,
  onClose,
  onCleaned
}: {
  machine: MachineSummary
  scan: MachineCleanupScan | null
  copy: MachineCleanupCopy | null
  onClose: () => void
  onCleaned: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<MachineCleanupResult | null>(null)
  const [seededFor, setSeededFor] = useState<MachineCleanupScan | null>(null)
  if (seededFor !== scan) {
    setSeededFor(scan)
    setPicked(new Set(scan?.items.filter((item) => item.preselected).map((item) => item.id)))
    setBusy(false)
    setError(null)
    setResult(null)
  }
  const items = scan?.items ?? []
  const chosen = items.filter((item) => picked.has(item.id))
  const chosenBytes = chosen.reduce((sum, item) => sum + (item.bytes ?? 0), 0)
  const toggle = (id: string): void =>
    setPicked((previous) => {
      const next = new Set(previous)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })

  const confirm = async (): Promise<void> => {
    if (!scan || busy || chosen.length === 0) {
      return
    }
    setBusy(true)
    try {
      const outcome = await machineResourceApi().runCleanup({
        machineId: machine.id,
        token: scan.token,
        itemIds: chosen.map((item) => item.id)
      })
      onCleaned()
      if (outcome.failures.length === 0) {
        toast.success(
          t('auto.components.machines.cleanup.freed', 'Freed {{size}} on {{machine}}.', {
            size: formatBytes(outcome.freedBytes),
            machine: machine.label
          })
        )
        onClose()
        return
      }
      setResult(outcome)
    } catch (err) {
      onCleaned()
      setError(resourceErrorText(err))
    }
    setBusy(false)
  }

  return (
    <Dialog open={scan !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl" data-machine-cleanup-dialog={scan?.target}>
        <DialogHeader>
          <DialogTitle>
            {t(
              'auto.components.machines.cleanup.dialogTitle',
              'Clean up {{what}} on {{machine}}?',
              {
                what: copy?.title ?? '',
                machine: machine.label
              }
            )}
          </DialogTitle>
          <DialogDescription>
            {`${copy?.removal ?? ''} ${t(
              'auto.components.machines.cleanup.permanent',
              'This cannot be undone.'
            )}`}
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="space-y-2 text-xs" role="alert">
            <p>
              {t(
                'auto.components.machines.cleanup.partial',
                'Removed {{removed}} items ({{size}}). {{failed}} could not be removed:',
                {
                  removed: result.removedIds.length,
                  size: formatBytes(result.freedBytes),
                  failed: result.failures.length
                }
              )}
            </p>
            <ul className="max-h-60 space-y-1 scrollbar-sleek overflow-y-auto">
              {result.failures.map((failure) => (
                <li key={failure.id} className="[overflow-wrap:anywhere]">
                  <span className="font-mono text-2xs">{failure.label}</span>
                  <span className="block text-destructive">{failure.message}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <>
            <label className="flex items-center gap-2 border-b border-border pb-2 text-xs">
              <Checkbox
                checked={
                  chosen.length === 0
                    ? false
                    : chosen.length === items.length
                      ? true
                      : 'indeterminate'
                }
                onCheckedChange={(checked) =>
                  setPicked(checked === true ? new Set(items.map((item) => item.id)) : new Set())
                }
              />
              <span className="flex-1">
                {t('auto.components.machines.cleanup.selected', '{{count}} of {{total}} selected', {
                  count: chosen.length,
                  total: items.length
                })}
              </span>
              <span className="font-mono tabular-nums">{formatBytes(chosenBytes)}</span>
            </label>
            <ul className="scrollbar-sleek max-h-72 overflow-y-auto">
              {items.map((item) => (
                <li key={item.id}>
                  <label className="flex items-start gap-2 rounded px-0.5 py-1 text-xs hover:bg-accent/40">
                    <Checkbox
                      className="mt-0.5"
                      checked={picked.has(item.id)}
                      onCheckedChange={() => toggle(item.id)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-2xs [overflow-wrap:anywhere]">
                        {item.label}
                      </span>
                      {item.group ? (
                        <span className="block text-2xs text-muted-foreground">{item.group}</span>
                      ) : null}
                    </span>
                    <span className="shrink-0 font-mono text-muted-foreground tabular-nums">
                      {formatBytes(item.bytes)}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            {scan && scan.omittedCount > 0 ? (
              <p className="text-2xs text-muted-foreground">
                {t(
                  'auto.components.machines.cleanup.omitted',
                  '{{count}} smaller matches are not listed and are left alone.',
                  {
                    count: scan.omittedCount,
                    defaultValue_one: '{{count}} smaller match is not listed and is left alone.'
                  }
                )}
              </p>
            ) : null}
          </>
        )}
        {error ? (
          <p className="text-xs text-destructive [overflow-wrap:anywhere]" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {result
              ? t('auto.components.machines.cleanup.close', 'Close')
              : t('auto.components.machines.cleanup.cancel', 'Cancel')}
          </Button>
          {result ? null : (
            <Button
              type="button"
              variant="destructive"
              disabled={busy || chosen.length === 0 || error !== null}
              onClick={() => void confirm()}
            >
              {busy ? <Loader2 className="animate-spin" /> : null}
              {t('auto.components.machines.cleanup.confirm', 'Remove {{count}} items ({{size}})', {
                count: chosen.length,
                size: formatBytes(chosenBytes),
                defaultValue_one: 'Remove {{count}} item ({{size}})'
              })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
