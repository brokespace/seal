import React, { useState } from 'react'
import { Check, ChevronRight, Loader2, TriangleAlert } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import type {
  MachineCleanupItem,
  MachineCleanupResult,
  MachineCleanupScan,
  MachineCleanupTargetId
} from '../../../../../shared/machines/machine-resource-types'
import { formatBytes } from '../model/machine-format'
import type { MachineCleanupCopy } from './use-machine-cleanup-copy'

export type MachineDockerCleanUpScan =
  | { status: 'scanning' }
  | { status: 'failed'; message: string }
  /** `items` are the ones a prune takes: nothing blocked, nothing a container still uses. */
  | { status: 'ready'; scan: MachineCleanupScan; items: MachineCleanupItem[]; bytes: number }

export type MachineDockerCleanUpOutcome = {
  freedBytes: number
  failures: MachineCleanupResult['failures']
  /** The cleanup itself could not run. */
  error: string | null
}

/** One kind of unused Docker data: what a cleanup would free, then what it did free. */
export function MachineDockerCleanUpCategory({
  target,
  copy,
  state,
  outcome,
  running,
  ticked,
  editable,
  onTick
}: {
  target: MachineCleanupTargetId
  copy: MachineCleanupCopy
  state: MachineDockerCleanUpScan
  outcome: MachineDockerCleanUpOutcome | null
  running: boolean
  ticked: boolean
  /** False once the cleanup has started. */
  editable: boolean
  onTick: (ticked: boolean) => void
}): React.JSX.Element {
  const t = useTranslate()
  const [listed, setListed] = useState(false)
  const count = state.status === 'ready' ? state.items.length : 0
  const failed = outcome ? outcome.error !== null || outcome.failures.length > 0 : false
  const skipped = !editable && !ticked && count > 0
  return (
    <li
      className="py-2 text-xs"
      data-machine-docker-clean-up-category={target}
      data-state={outcome ? (failed ? 'failed' : 'done') : running ? 'running' : state.status}
    >
      <div className="flex items-start gap-2">
        <label className="flex min-w-0 flex-1 items-start gap-2">
          <Checkbox
            className="mt-0.5"
            disabled={!editable || count === 0}
            checked={count > 0 && ticked}
            onCheckedChange={(checked) => onTick(checked === true)}
          />
          <span className="min-w-0 flex-1">
            <span className={cn('block font-medium', count === 0 && 'text-muted-foreground')}>
              {copy.title}
            </span>
            <span className="block text-2xs text-muted-foreground">{copy.description}</span>
          </span>
        </label>
        <div className="flex shrink-0 flex-col items-end font-mono whitespace-nowrap tabular-nums">
          {outcome ? (
            <span className="inline-flex items-center gap-1">
              {failed ? null : <Check className="size-3 text-muted-foreground" />}
              {outcome.error
                ? t('auto.components.machines.dockerCleanUp.failed', 'Failed')
                : t('auto.components.machines.dockerCleanUp.freed', 'Freed {{size}}', {
                    size: formatBytes(outcome.freedBytes)
                  })}
            </span>
          ) : running || state.status === 'scanning' ? (
            <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
          ) : skipped ? (
            <span className="font-sans text-muted-foreground">
              {t('auto.components.machines.dockerCleanUp.skipped', 'Left alone')}
            </span>
          ) : state.status === 'ready' && count > 0 ? (
            <>
              <span className={cn(!ticked && 'text-muted-foreground')}>
                {formatBytes(state.bytes)}
              </span>
              <button
                type="button"
                className="flex items-center gap-0.5 rounded-sm font-sans text-2xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                aria-expanded={listed}
                onClick={() => setListed(!listed)}
                data-machine-docker-clean-up-items
              >
                {t('auto.components.machines.cleanup.items', '{{count}} items', {
                  count,
                  defaultValue_one: '{{count}} item'
                })}
                <ChevronRight
                  className={cn('size-3 transition-transform', listed && 'rotate-90')}
                />
              </button>
            </>
          ) : state.status === 'ready' ? (
            <span className="font-sans text-muted-foreground">
              {t('auto.components.machines.dockerCleanUp.nothing', 'Nothing to remove')}
            </span>
          ) : null}
        </div>
      </div>
      <div className="space-y-1 pl-6 empty:hidden">
        {target === 'docker-volumes' && count > 0 && !outcome && !skipped ? (
          <p className="mt-1 flex items-start gap-1 text-2xs text-status-warning-text">
            <TriangleAlert className="mt-0.5 size-3 shrink-0" />
            <span>
              {t(
                'auto.components.machines.dockerCleanUp.volumesCaution',
                'Volumes hold data. Removing a volume cannot be undone.'
              )}
            </span>
          </p>
        ) : null}
        {state.status === 'failed' || outcome?.error ? (
          <p className="mt-1 text-2xs text-destructive [overflow-wrap:anywhere]" role="alert">
            {outcome?.error ?? (state.status === 'failed' ? state.message : '')}
          </p>
        ) : null}
        {listed && state.status === 'ready' && !outcome && !skipped ? (
          <ul className="mt-1 max-h-32 scrollbar-sleek overflow-y-auto rounded-md bg-muted/50 px-2 py-1">
            {state.items.map((item) => (
              <li key={item.id} className="flex items-baseline gap-2 text-2xs">
                <span className="min-w-0 flex-1 truncate font-mono" title={item.label}>
                  {item.label}
                </span>
                <span className="shrink-0 font-mono text-muted-foreground tabular-nums">
                  {formatBytes(item.bytes)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  )
}
