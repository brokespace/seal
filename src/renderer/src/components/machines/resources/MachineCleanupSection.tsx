import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import { installWindowVisibilityInterval } from '@/lib/window-activity/window-visibility-interval'
import type {
  MachineCleanupScan,
  MachineCleanupTargetId
} from '../../../../../shared/machines/machine-resource-types'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import { formatBytes } from '../model/machine-format'
import { MachineCleanupDialog } from './MachineCleanupDialog'
import { machineResourceApi, resourceErrorText } from './machine-resource-requests'
import { useMachineCleanupCopy } from './use-machine-cleanup-copy'

/** Each round sizes caches on the machine, so the list follows it without keeping it busy. */
const CLEANUP_REFRESH_MS = 60_000

type TargetState =
  | { status: 'scanning' }
  | { status: 'ready'; scan: MachineCleanupScan }
  | { status: 'failed'; message: string }

/**
 * Space that can be freed, with sizes that keep themselves current. Scanning only reads; removal
 * goes through the review dialog.
 */
export function MachineCleanupSection({
  machine,
  targets: wanted,
  onCleaned
}: {
  machine: MachineSummary
  targets: readonly MachineCleanupTargetId[]
  onCleaned: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const copy = useMachineCleanupCopy()
  const machineId = machine.id
  const [targets, setTargets] = useState<Partial<Record<MachineCleanupTargetId, TargetState>>>({})
  const [reviewing, setReviewing] = useState<MachineCleanupScan | null>(null)
  const reviewingRef = useRef(false)
  useEffect(() => {
    reviewingRef.current = reviewing !== null
  }, [reviewing])

  const scanTarget = useCallback(
    async (target: MachineCleanupTargetId, isCurrent: () => boolean): Promise<void> => {
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
    let running = false
    const stop = installWindowVisibilityInterval({
      run: () => {
        // A list under review must not change beneath the person ticking it.
        if (running || reviewingRef.current) {
          return
        }
        running = true
        // One at a time: each scan walks the disk, and a machine being cleaned up is already busy.
        void (async () => {
          for (const target of wanted) {
            if (cancelled) {
              return
            }
            await scanTarget(target, () => !cancelled)
          }
          running = false
        })()
      },
      intervalMs: CLEANUP_REFRESH_MS
    })
    return () => {
      cancelled = true
      stop()
    }
  }, [scanTarget, wanted])

  const scanning = wanted.some((target) => (targets[target]?.status ?? 'scanning') === 'scanning')
  const reclaimable = wanted.reduce((sum, target) => {
    const state = targets[target]
    return sum + (state?.status === 'ready' ? state.scan.totalBytes : 0)
  }, 0)

  return (
    <div data-machine-cleanup={scanning ? 'scanning' : 'ready'}>
      <p className="border-b border-border px-3 py-2 text-2xs text-muted-foreground">
        {t(
          'auto.components.machines.cleanup.intro',
          'Nothing is removed until you review a list and confirm it. Up to {{size}} found so far.',
          { size: formatBytes(reclaimable) }
        )}
      </p>
      <ul>
        {wanted.map((target) => {
          const state = targets[target] ?? { status: 'scanning' }
          const scan = state.status === 'ready' ? state.scan : null
          return (
            <li
              key={target}
              className="flex items-center gap-3 border-b border-border/60 px-3 py-2 text-xs last:border-b-0"
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
