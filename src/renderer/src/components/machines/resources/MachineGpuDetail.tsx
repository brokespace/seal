import React from 'react'
import { useTranslate } from '@/i18n/use-translate'
import {
  summarizeMachineGpus,
  type MachineGpu
} from '../../../../../shared/machines/machine-gpu-types'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import type { MachineMetrics } from '../../../../../shared/machines/machine-types'
import { formatBytes } from '../model/machine-format'
import { formatGpuPercent, formatGpuWatts } from '../model/machine-gpu-format'
import { useMachineGpuHistory } from '../model/machine-gpu-history'
import { MachineGpuCard } from './MachineGpuCard'
import { MachineProcessesView } from './MachineProcessesView'
import { MachineResourceStat, MachineResourceStats } from './MachineResourceStat'

function GpuTotals({ gpus }: { gpus: readonly MachineGpu[] }): React.JSX.Element {
  const t = useTranslate()
  const summary = summarizeMachineGpus(gpus)
  const limits = gpus.map((gpu) => gpu.powerLimitWatts)
  const powerLimit = limits.every((limit) => limit !== null)
    ? limits.reduce((total, limit) => total + limit, 0)
    : null
  const hottest = gpus.find(
    (gpu) => summary.temperatureC !== null && gpu.temperatureC === summary.temperatureC
  )
  return (
    <MachineResourceStats>
      <MachineResourceStat
        label={t('auto.components.machines.gpu.utilization', 'Utilization')}
        value={formatGpuPercent(summary.utilizationPercent)}
        detail={t('auto.components.machines.gpu.average', 'average of {{count}} GPUs', {
          count: gpus.length,
          defaultValue_one: '{{count}} GPU'
        })}
      />
      <MachineResourceStat
        label={t('auto.components.machines.gpu.memoryUsed', 'Memory used')}
        value={formatBytes(summary.memoryUsedBytes)}
        detail={
          summary.memoryTotalBytes === null
            ? undefined
            : t('auto.components.machines.memory.ofTotal', 'of {{total}}', {
                total: formatBytes(summary.memoryTotalBytes)
              })
        }
      />
      <MachineResourceStat
        label={t('auto.components.machines.gpu.power', 'Power')}
        value={formatGpuWatts(summary.powerDrawWatts)}
        detail={
          powerLimit === null || gpus.length === 0
            ? undefined
            : t('auto.components.machines.gpu.powerLimit', 'of a {{limit}} limit', {
                limit: formatGpuWatts(powerLimit)
              })
        }
      />
      <MachineResourceStat
        label={t('auto.components.machines.gpu.hottest', 'Hottest')}
        value={summary.temperatureC === null ? '—' : `${Math.round(summary.temperatureC)} °C`}
        detail={
          hottest && gpus.length > 1
            ? t('auto.components.machines.gpu.index', 'GPU {{index}}', { index: hottest.index })
            : undefined
        }
      />
    </MachineResourceStats>
  )
}

/** Each GPU's readings with their recent history, then the processes on the GPUs. */
export function MachineGpuDetail({
  machine,
  metrics
}: {
  machine: MachineSummary
  metrics: MachineMetrics | null
}): React.JSX.Element {
  const t = useTranslate()
  const history = useMachineGpuHistory(machine.id)
  return (
    <MachineProcessesView
      machine={machine}
      initialSort="gpu"
      summary={(snapshot) => {
        // The overview's readings fill in until the first sample of this view arrives.
        const gpus = snapshot?.gpu?.gpus ?? metrics?.gpus ?? []
        if (gpus.length === 0) {
          return (
            <p className="text-sm text-muted-foreground">
              {t('auto.components.machines.gpu.none', 'No GPU is reporting on this machine.')}
            </p>
          )
        }
        return (
          <>
            <GpuTotals gpus={gpus} />
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(13rem,100%),1fr))] items-start gap-3">
              {gpus.map((gpu) => (
                <MachineGpuCard key={gpu.index} gpu={gpu} history={history.get(gpu.index)} />
              ))}
            </div>
          </>
        )
      }}
    />
  )
}
