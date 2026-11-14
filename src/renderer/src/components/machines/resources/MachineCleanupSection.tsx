import React, { useCallback, useEffect, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import {
  MACHINE_CLEANUP_TARGETS,
  type MachineCleanupScan,
  type MachineCleanupTargetId
} from '../../../../../shared/machines/machine-resource-types'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import { formatBytes } from '../model/machine-format'
import { MachineCleanupDialog } from './MachineCleanupDialog'
import { machineResourceApi, resourceErrorText } from './machine-resource-requests'
import { useMachineCleanupCopy } from './use-machine-cleanup-copy'

type TargetState =
  | { status: 'scanning' }
  | { status: 'ready'; scan: MachineCleanupScan }
  | { status: 'failed'; message: string }

/** Common space hogs with their sizes. Scanning only reads; removal goes through the review dialog. */
export function MachineCleanupSection({
  machine,
  onCleaned
}: {
  machine: MachineSummary
  onCleaned: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const copy = useMachineCleanupCopy()
  const machineId = machine.id
  const [targets, setTargets] = useState<Partial<Record<MachineCleanupTargetId, TargetState>>>({})
  const [reviewing, setReviewing] = useState<MachineCleanupScan | null>(null)
  const [scanRound, setScanRound] = useState(0)

  const scanTarget = useCallback(
    async (target: MachineCleanupTargetId, isCurrent: () => boolean): Promise<void> => {
      setTargets((previous) => ({ ...previous, [target]: { status: 'scanning' } }))
      let next: TargetState
      try {
        next = {
          status: 'ready',
          scan: await machineResourceApi().scanCleanup({ machineId, target })
        }
      } catch (err) {
        next = { status: 'failed', message: resourceErrorText(err) }
      }
      if (isCurrent()) {
        setTargets((previous) => ({ ...previous, [target]: next }))
      }
    },
    [machineId]
  )

  useEffect(() => {
    let cancelled = false
    // One at a time: each scan walks the disk, and a machine being cleaned up is already busy.
    void (async () => {
      for (const target of MACHINE_CLEANUP_TARGETS) {
        if (cancelled) {
          return
        }
        await scanTarget(target, () => !cancelled)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [scanTarget, scanRound])

  const scanning = MACHINE_CLEANUP_TARGETS.some(
    (target) => (targets[target]?.status ?? 'scanning') === 'scanning'
  )
  const reclaimable = MACHINE_CLEANUP_TARGETS.reduce((sum, target) => {
    const state = targets[target]
    return sum + (state?.status === 'ready' ? state.scan.totalBytes : 0)
  }, 0)

  return (
    <div data-machine-cleanup={scanning ? 'scanning' : 'ready'}>
      <div className="flex items-center gap-2 border-b border-border pb-1.5 text-2xs text-muted-foreground">
        <span className="min-w-0 flex-1">
          {t(
            'auto.components.machines.cleanup.intro',
            'Nothing is removed until you review a list and confirm it. Up to {{size}} found so far.',
            { size: formatBytes(reclaimable) }
          )}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={scanning}
          onClick={() => setScanRound((round) => round + 1)}
        >
          <RefreshCw />
          {t('auto.components.machines.cleanup.rescan', 'Scan again')}
        </Button>
      </div>
      <ul>
        {MACHINE_CLEANUP_TARGETS.map((target) => {
          const state = targets[target] ?? { status: 'scanning' }
          const scan = state.status === 'ready' ? state.scan : null
          return (
            <li
              key={target}
              className="flex items-center gap-3 border-b border-border/60 px-2 py-2 text-xs"
              data-machine-cleanup-target={target}
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium">{copy[target].title}</div>
                <div className="text-2xs text-muted-foreground [overflow-wrap:anywhere]">
                  {state.status === 'failed'
                    ? state.message
                    : (scan?.unavailable ?? copy[target].description)}
                </div>
              </div>
              <div className="shrink-0 text-right font-mono whitespace-nowrap tabular-nums">
                {state.status === 'scanning' ? (
                  <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                ) : scan && !scan.unavailable ? (
                  <>
                    {formatBytes(scan.totalBytes)}
                    <span className="block text-2xs text-muted-foreground">
                      {t('auto.components.machines.cleanup.items', '{{count}} items', {
                        count: scan.items.length,
                        defaultValue_one: '{{count}} item'
                      })}
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={!scan || scan.items.length === 0}
                onClick={() => setReviewing(scan)}
              >
                {t('auto.components.machines.cleanup.review', 'Review…')}
              </Button>
            </li>
          )
        })}
      </ul>
      <MachineCleanupDialog
        machine={machine}
        scan={reviewing}
        copy={reviewing ? copy[reviewing.target] : null}
        onClose={() => setReviewing(null)}
        onCleaned={() => {
          if (reviewing) {
            // The reviewed list is spent once used; the row needs a fresh one.
            void scanTarget(reviewing.target, () => true)
          }
          onCleaned()
        }}
      />
    </div>
  )
}
