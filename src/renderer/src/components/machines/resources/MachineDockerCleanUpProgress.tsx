import React, { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import type {
  MachineCleanupProgress,
  MachineCleanupResult
} from '../../../../../shared/machines/machine-resource-types'
import { machineResourceApi } from './machine-resource-requests'

/** How far the cleanup started under `token` is; null before its first batch and with no token. */
export function useMachineCleanupProgress(token: string | null): MachineCleanupProgress | null {
  const [progress, setProgress] = useState<MachineCleanupProgress | null>(null)
  useEffect(() => {
    if (token === null) {
      return
    }
    return machineResourceApi().onCleanupProgress((next) => {
      if (next.token === token) {
        setProgress(next)
      }
    })
  }, [token])
  return progress?.token === token ? progress : null
}

/** A running cleanup: what is being removed now and how many are done. */
export function MachineCleanupProgressLine({
  progress,
  className
}: {
  progress: MachineCleanupProgress | null
  className?: string
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <div
      className={cn('space-y-1.5 text-xs', className)}
      role="status"
      data-machine-cleanup-progress={progress ? `${progress.done}/${progress.total}` : 'starting'}
    >
      <div className="flex items-center gap-2">
        <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">
          {progress?.current
            ? t('auto.components.machines.cleanup.removing', 'Removing {{current}}', {
                current: progress.current
              })
            : t('auto.components.machines.cleanup.removingAny', 'Removing…')}
        </span>
        {progress ? (
          <span className="shrink-0 font-mono text-2xs text-muted-foreground tabular-nums">
            {t('auto.components.machines.cleanup.progress', '{{done}} of {{total}}', {
              done: progress.done,
              total: progress.total
            })}
          </span>
        ) : null}
      </div>
      <Progress
        className="h-1"
        value={progress && progress.total > 0 ? (progress.done / progress.total) * 100 : 0}
      />
    </div>
  )
}

/** What a cleanup could not remove, each with the reason the machine gave. */
export function MachineCleanupFailureList({
  failures
}: {
  failures: MachineCleanupResult['failures']
}): React.JSX.Element {
  return (
    <ul
      className="max-h-60 space-y-1 scrollbar-sleek overflow-y-auto"
      data-machine-cleanup-failures
    >
      {failures.map((failure) => (
        <li key={failure.id} className="[overflow-wrap:anywhere]">
          <span className="font-mono text-2xs">{failure.label}</span>
          <span className="block text-destructive">{failure.message}</span>
        </li>
      ))}
    </ul>
  )
}
