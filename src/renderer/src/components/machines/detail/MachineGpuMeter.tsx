import React from 'react'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import {
  summarizeMachineGpus,
  type MachineGpu
} from '../../../../../shared/machines/machine-gpu-types'
import { formatGpuReadings, formatGpuSummary } from '../model/machine-gpu-format'
import { machineGpuMemoryPercent } from '../model/machine-gpu-history'
import { machineMeterTone } from '../model/machine-meter-tone'

/** A row holds eight GPUs; a machine with more wraps onto the next row. */
const CELLS_PER_ROW = 8

function Bar({
  percent,
  tone,
  className
}: {
  percent: number | null
  tone: string
  className: string
}): React.JSX.Element {
  return (
    <div className={cn('overflow-hidden rounded-full bg-muted', className)}>
      <div
        className={cn('h-full rounded-full transition-[width] duration-500', tone)}
        style={{ width: `${percent ?? 0}%` }}
      />
    </div>
  )
}

/**
 * Every GPU as a pair of bars, how busy it is over how full its memory is, in index order. Neither
 * warns: a GPU at full load with full memory is a training run going well.
 */
export function MachineGpuCells({
  gpus,
  compact = false
}: {
  gpus: readonly MachineGpu[]
  compact?: boolean
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <div
      className="grid min-w-0 flex-1 gap-x-1 gap-y-1.5"
      style={{
        gridTemplateColumns: `repeat(${Math.min(gpus.length, CELLS_PER_ROW)}, minmax(0, 1fr))`
      }}
      data-machine-gpu-cells={gpus.length}
    >
      {gpus.map((gpu) => {
        const memory = machineGpuMemoryPercent(gpu)
        const label = t('auto.components.machines.gpu.cell', 'GPU {{index}}: {{readings}}', {
          index: gpu.index,
          readings: formatGpuReadings(gpu)
        })
        return (
          <div
            key={gpu.index}
            role="img"
            aria-label={label}
            title={label}
            className="space-y-0.5"
            data-machine-gpu-cell={gpu.index}
          >
            <Bar
              percent={gpu.utilizationPercent}
              tone={machineMeterTone(gpu.utilizationPercent, 'neutral')}
              className={compact ? 'h-1' : 'h-1.5'}
            />
            <Bar percent={memory} tone="bg-foreground/35" className="h-0.5" />
          </div>
        )
      })}
    </div>
  )
}

function useGpuCountLabel(): (count: number) => string {
  const t = useTranslate()
  return (count) =>
    t('auto.components.machines.gpu.count', '{{count}} GPUs', {
      count,
      defaultValue_one: '{{count}} GPU'
    })
}

/** The GPU block of a machine's row in the list: one cell per GPU, then the totals. */
export function MachineGpuListMeter({ gpus }: { gpus: readonly MachineGpu[] }): React.JSX.Element {
  const t = useTranslate()
  const countLabel = useGpuCountLabel()
  const summary = formatGpuSummary(summarizeMachineGpus(gpus))
  return (
    <div className="w-full space-y-1 pl-6" data-machine-gpu-summary={gpus.length}>
      <div className="flex items-center gap-1.5">
        <span className="w-9 shrink-0 text-3xs font-medium tracking-wide text-muted-foreground uppercase">
          {t('auto.components.machines.vitals.gpu', 'GPU')}
        </span>
        <MachineGpuCells gpus={gpus} compact />
      </div>
      <div className="truncate pl-[2.625rem] font-mono text-3xs text-muted-foreground tabular-nums">
        {[countLabel(gpus.length), summary].filter(Boolean).join(' · ')}
      </div>
    </div>
  )
}

/** The GPU meter of the vitals strip: the totals over one cell per GPU. */
export function MachineGpuMeter({ gpus }: { gpus: readonly MachineGpu[] }): React.JSX.Element {
  const countLabel = useGpuCountLabel()
  return (
    <div className="min-w-0 space-y-1" data-machine-gpu-summary={gpus.length}>
      <div className="flex items-baseline justify-between gap-1 text-2xs text-muted-foreground">
        <span className="shrink-0 font-medium tracking-wide uppercase">
          {countLabel(gpus.length)}
        </span>
        <span className="truncate font-mono tabular-nums">
          {formatGpuSummary(summarizeMachineGpus(gpus)) || '—'}
        </span>
      </div>
      <MachineGpuCells gpus={gpus} />
    </div>
  )
}
