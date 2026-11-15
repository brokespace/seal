import React from 'react'
import { useTranslate } from '@/i18n/use-translate'
import type { MachineGpuProcess } from '../../../../../shared/machines/machine-gpu-types'
import { formatBytes } from '../model/machine-format'

/** GPU processes the machine's own process list does not show, so there is nothing to signal. */
export function MachineGpuUnlistedProcesses({
  processes
}: {
  processes: readonly MachineGpuProcess[]
}): React.JSX.Element | null {
  const t = useTranslate()
  if (processes.length === 0) {
    return null
  }
  return (
    <div className="pt-3 text-2xs text-muted-foreground" data-machine-gpu-unlisted>
      <p>
        {t(
          'auto.components.machines.gpu.unlisted',
          'The driver also reports these, but the machine does not list them as processes (they may have just exited, or run where this account cannot see them), so they cannot be stopped from here:'
        )}
      </p>
      <ul className="mt-1 space-y-0.5 font-mono">
        {processes.map((process) => (
          <li key={`${process.pid}:${process.gpuIndex}`} className="flex gap-2">
            <span className="min-w-0 flex-1 truncate" title={process.name}>
              {process.name || '—'}
            </span>
            <span className="shrink-0 tabular-nums">{process.pid}</span>
            <span className="w-14 shrink-0 text-right">
              {process.gpuIndex === null
                ? '—'
                : t('auto.components.machines.gpu.index', 'GPU {{index}}', {
                    index: process.gpuIndex
                  })}
            </span>
            <span className="w-20 shrink-0 text-right tabular-nums">
              {formatBytes(process.memoryBytes)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
