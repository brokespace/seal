import React from 'react'
import { PageCard } from '@/components/page-layout/PageCard'
import { Sparkline } from '@/components/status-bar/resources/popover/resource-usage-metrics'
import { Badge } from '@/components/ui/badge'
import { useTranslate } from '@/i18n/use-translate'
import type { MachineGpu } from '../../../../../shared/machines/machine-gpu-types'
import { MachineMeter } from '../detail/MachineVitals'
import { formatGpuMemory, formatGpuWatts } from '../model/machine-gpu-format'
import { machineGpuMemoryPercent, type MachineGpuHistory } from '../model/machine-gpu-history'

// A little past both ends, so a line at 0% or 100% is not drawn on the edge of its box.
const PERCENT_DOMAIN = [-8, 108] as const

/** A reading beside the line of its recent samples; the line waits for a second sample. */
function MeterWithHistory({
  samples,
  children
}: {
  samples: readonly (number | null)[]
  children: React.ReactNode
}): React.JSX.Element {
  // Only the samples since the driver last had no figure: older ones are not the recent past.
  const known = samples.slice(samples.lastIndexOf(null) + 1).filter((sample) => sample !== null)
  return (
    <div className="flex flex-col gap-1 @[15rem]:flex-row @[15rem]:items-end @[15rem]:gap-3">
      <div className="min-w-0 flex-1">{children}</div>
      <div
        className="h-5 w-full shrink-0 @[15rem]:w-16 [&>svg]:w-full"
        data-machine-gpu-history={known.length}
      >
        {known.length > 1 ? (
          <Sparkline samples={known} width={64} height={20} domain={PERCENT_DOMAIN} />
        ) : null}
      </div>
    </div>
  )
}

function Fact({
  label,
  value,
  title
}: {
  label: string
  value: string
  title?: string
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-2" title={title}>
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="truncate font-mono tabular-nums">{value}</dd>
    </div>
  )
}

/** Everything one GPU reports; a figure its driver does not give is left out. */
export function MachineGpuCard({
  gpu,
  history
}: {
  gpu: MachineGpu
  history: MachineGpuHistory | undefined
}): React.JSX.Element {
  const t = useTranslate()
  const facts = [
    gpu.temperatureC === null
      ? null
      : {
          label: t('auto.components.machines.gpu.temperature', 'Temperature'),
          value: `${Math.round(gpu.temperatureC)} °C`
        },
    gpu.powerDrawWatts === null
      ? null
      : {
          label: t('auto.components.machines.gpu.power', 'Power'),
          value:
            gpu.powerLimitWatts === null
              ? formatGpuWatts(gpu.powerDrawWatts)
              : `${Math.round(gpu.powerDrawWatts)} / ${formatGpuWatts(gpu.powerLimitWatts)}`
        },
    gpu.fanPercent === null
      ? null
      : {
          label: t('auto.components.machines.gpu.fan', 'Fan'),
          value: `${Math.round(gpu.fanPercent)}%`
        },
    gpu.clockGraphicsMhz === null
      ? null
      : {
          label:
            gpu.clockMemoryMhz === null
              ? t('auto.components.machines.gpu.clock', 'Core clock')
              : t('auto.components.machines.gpu.clocks', 'Clocks'),
          title: t('auto.components.machines.gpu.clocksDetail', 'Core clock / memory clock'),
          value:
            gpu.clockMemoryMhz === null
              ? `${gpu.clockGraphicsMhz} MHz`
              : `${gpu.clockGraphicsMhz} / ${gpu.clockMemoryMhz} MHz`
        }
  ].filter((fact) => fact !== null)
  return (
    <PageCard
      title={t('auto.components.machines.gpu.index', 'GPU {{index}}', { index: gpu.index })}
      action={
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-2xs text-muted-foreground" title={gpu.name}>
            {gpu.name}
          </span>
          {gpu.mig ? (
            <Badge
              variant="referenceLabel"
              title={t(
                'auto.components.machines.gpu.migDetail',
                'Split into MIG instances, so the driver reports no utilization for the whole card.'
              )}
            >
              {t('auto.components.machines.gpu.mig', 'MIG')}
            </Badge>
          ) : null}
        </span>
      }
    >
      <div className="@container space-y-3 p-3" data-machine-gpu-card={gpu.index}>
        <MeterWithHistory samples={history?.utilizationPercent ?? []}>
          <MachineMeter
            label={t('auto.components.machines.gpu.utilization', 'Utilization')}
            percent={gpu.utilizationPercent}
            tone="neutral"
          />
        </MeterWithHistory>
        <MeterWithHistory samples={history?.memoryUsedPercent ?? []}>
          <MachineMeter
            label={t('auto.components.machines.gpu.memory', 'Memory')}
            percent={machineGpuMemoryPercent(gpu)}
            detail={formatGpuMemory(gpu.memoryUsedBytes, gpu.memoryTotalBytes)}
            tone="neutral"
          />
        </MeterWithHistory>
        {facts.length > 0 ? (
          <dl className="grid gap-x-6 gap-y-1 text-2xs @[22rem]:grid-cols-2">
            {facts.map((fact) => (
              <Fact key={fact.label} {...fact} />
            ))}
          </dl>
        ) : null}
      </div>
    </PageCard>
  )
}
