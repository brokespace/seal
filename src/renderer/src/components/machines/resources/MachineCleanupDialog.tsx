import React, { useEffect, useRef, useState } from 'react'
import { Ban, Loader2, TriangleAlert } from 'lucide-react'
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
import { cn } from '@/lib/class-names'
import type {
  MachineCleanupItem,
  MachineCleanupResult,
  MachineCleanupScan
} from '../../../../../shared/machines/machine-resource-types'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import { formatBytes } from '../model/machine-format'
import {
  MachineCleanupFailureList,
  MachineCleanupProgressLine,
  useMachineCleanupProgress
} from './MachineDockerCleanUpProgress'
import { machineResourceApi, resourceErrorText } from './machine-resource-requests'
import { useMachineCleanupInUseCopy, type MachineCleanupCopy } from './use-machine-cleanup-copy'

function isInUse(item: MachineCleanupItem): boolean {
  return (item.inUseBy?.length ?? 0) > 0
}

/**
 * Lists exactly what a cleanup removes and removes only what stays ticked. Nothing on the machine
 * changes before the confirm button is pressed.
 */
export function MachineCleanupDialog({
  machine,
  scan,
  copy,
  heading,
  onClose,
  onCleaned
}: {
  machine: MachineSummary
  scan: MachineCleanupScan | null
  copy: Pick<MachineCleanupCopy, 'title' | 'removal'> | null
  /** Replaces the title built from `copy.title`. */
  heading?: string
  onClose: () => void
  onCleaned: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const inUseCopy = useMachineCleanupInUseCopy()
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<MachineCleanupResult | null>(null)
  const [seededFor, setSeededFor] = useState<MachineCleanupScan | null>(null)
  if (seededFor !== scan) {
    setSeededFor(scan)
    setPicked(
      new Set(
        scan?.items.filter((item) => item.preselected && !item.blocked).map((item) => item.id)
      )
    )
    setBusy(false)
    setError(null)
    setResult(null)
  }
  const shownScan = useRef(scan)
  useEffect(() => {
    shownScan.current = scan
  }, [scan])
  const progress = useMachineCleanupProgress(busy && scan ? scan.token : null)
  const items = scan?.items ?? []
  const removable = items.filter((item) => !item.blocked)
  const chosen = removable.filter((item) => picked.has(item.id))
  const chosenBytes = chosen.reduce((sum, item) => sum + (item.bytes ?? 0), 0)
  const chosenInUse = chosen.filter(isInUse).length
  const allBlocked = items.length > 0 && removable.length === 0
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
    let outcome: MachineCleanupResult | null = null
    let failure: string | null = null
    try {
      outcome = await machineResourceApi().runCleanup({
        machineId: machine.id,
        token: scan.token,
        itemIds: chosen.map((item) => item.id)
      })
    } catch (err) {
      failure = resourceErrorText(err)
    }
    onCleaned()
    // Closed while it ran: the outcome has nowhere to show but a toast.
    const open = shownScan.current === scan
    if (outcome && outcome.failures.length === 0) {
      toast.success(
        t('auto.components.machines.cleanup.freed', 'Freed {{size}} on {{machine}}.', {
          size: formatBytes(outcome.freedBytes),
          machine: machine.label
        })
      )
      if (open) {
        onClose()
      }
      return
    }
    if (!open) {
      toast.error(
        failure ??
          t(
            'auto.components.machines.cleanup.partialToast',
            '{{count}} items could not be removed from {{machine}}.',
            {
              count: outcome?.failures.length ?? 0,
              machine: machine.label,
              defaultValue_one: '{{count}} item could not be removed from {{machine}}.'
            }
          )
      )
      return
    }
    setResult(outcome)
    setError(failure)
    setBusy(false)
  }

  return (
    <Dialog open={scan !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="sm:max-w-xl"
        data-machine-cleanup-dialog={scan?.target}
        data-machine-cleanup-state={result ? 'result' : busy ? 'running' : 'review'}
      >
        <DialogHeader>
          <DialogTitle>
            {heading ??
              t(
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
                'auto.components.machines.cleanup.partialResult',
                'Removed {{count}} items ({{size}}). {{failed}} could not be removed:',
                {
                  count: result.removedIds.length,
                  size: formatBytes(result.freedBytes),
                  failed: result.failures.length,
                  defaultValue_one:
                    'Removed {{count}} item ({{size}}). {{failed}} could not be removed:'
                }
              )}
            </p>
            <MachineCleanupFailureList failures={result.failures} />
          </div>
        ) : (
          <>
            <label
              className={cn(
                'flex items-center gap-2 border-b border-border pb-2 text-xs',
                allBlocked && 'hidden'
              )}
            >
              <Checkbox
                disabled={busy || removable.length === 0}
                checked={
                  chosen.length === 0
                    ? false
                    : chosen.length === removable.length
                      ? true
                      : 'indeterminate'
                }
                onCheckedChange={(checked) =>
                  setPicked(
                    checked === true ? new Set(removable.map((item) => item.id)) : new Set()
                  )
                }
              />
              <span className="flex-1">
                {t('auto.components.machines.cleanup.selected', '{{count}} of {{total}} selected', {
                  count: chosen.length,
                  total: removable.length
                })}
              </span>
              <span className="font-mono tabular-nums">{formatBytes(chosenBytes)}</span>
            </label>
            <ul className="scrollbar-sleek max-h-72 overflow-y-auto">
              {items.map((item) => (
                <li
                  key={item.id}
                  data-machine-cleanup-item={
                    item.blocked ? 'blocked' : isInUse(item) ? 'in-use' : 'removable'
                  }
                >
                  <label
                    className={cn(
                      'flex items-start gap-2 rounded px-0.5 py-1 text-xs',
                      !item.blocked && !busy && 'hover:bg-accent/40'
                    )}
                  >
                    <Checkbox
                      className="mt-0.5"
                      disabled={busy || item.blocked !== undefined}
                      checked={!item.blocked && picked.has(item.id)}
                      onCheckedChange={() => toggle(item.id)}
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          'block font-mono text-2xs [overflow-wrap:anywhere]',
                          item.blocked && 'text-muted-foreground'
                        )}
                      >
                        {item.label}
                      </span>
                      {item.group ? (
                        <span className="block text-2xs text-muted-foreground">{item.group}</span>
                      ) : null}
                      {item.blocked ? (
                        <span className="mt-0.5 flex items-start gap-1 text-2xs text-muted-foreground">
                          <Ban className="mt-0.5 size-3 shrink-0" />
                          <span>{item.blocked}</span>
                        </span>
                      ) : scan && isInUse(item) ? (
                        <span className="mt-0.5 flex items-start gap-1 text-2xs text-status-warning-text">
                          <TriangleAlert className="mt-0.5 size-3 shrink-0" />
                          <span>{inUseCopy(scan.target).item(item.inUseBy ?? [])}</span>
                        </span>
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
            {allBlocked ? (
              <p className="text-xs text-muted-foreground" data-machine-cleanup-all-blocked>
                {t(
                  'auto.components.machines.cleanup.allBlocked',
                  'None of these can be removed from here. Each line says what is holding it.'
                )}
              </p>
            ) : null}
            {busy ? (
              <MachineCleanupProgressLine progress={progress} />
            ) : scan && chosenInUse > 0 ? (
              <p
                className="flex items-start gap-1.5 text-xs text-status-warning-text"
                role="alert"
                data-machine-cleanup-in-use-warning
              >
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                <span>{inUseCopy(scan.target).ticked(chosenInUse)}</span>
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
          {busy ? (
            <p className="mr-auto self-center text-2xs text-muted-foreground">
              {t(
                'auto.components.machines.cleanup.keepsRunning',
                'Closing this does not stop the removal.'
              )}
            </p>
          ) : null}
          <Button type="button" variant="outline" onClick={onClose}>
            {result || busy || allBlocked
              ? t('auto.components.machines.cleanup.close', 'Close')
              : t('auto.components.machines.cleanup.cancel', 'Cancel')}
          </Button>
          {result || allBlocked ? null : (
            <Button
              type="button"
              variant="destructive"
              disabled={busy || chosen.length === 0 || error !== null}
              onClick={() => void confirm()}
              data-machine-cleanup-confirm={chosenInUse > 0 ? 'in-use' : 'plain'}
            >
              {busy ? <Loader2 className="animate-spin" /> : null}
              {chosenInUse > 0
                ? t('auto.components.machines.cleanup.confirmAnyway', 'Remove anyway')
                : t(
                    'auto.components.machines.cleanup.confirm',
                    'Remove {{count}} items ({{size}})',
                    {
                      count: chosen.length,
                      size: formatBytes(chosenBytes),
                      defaultValue_one: 'Remove {{count}} item ({{size}})'
                    }
                  )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
