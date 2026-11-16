import React from 'react'
import { PageCard } from '@/components/page-layout/PageCard'
import { useTranslate } from '@/i18n/use-translate'
import type { MachineMetrics, MachineOs } from '../../../../../shared/machines/machine-types'
import { formatTemperature } from '../model/machine-format'
import { MachineResourceFact, MachineResourceStat } from './MachineResourceStat'

/** What stands between this kind of machine and a reading, for the hover of an empty one. */
function useMissingSensorHint(): (os: MachineOs | null) => string {
  const t = useTranslate()
  return (os) => {
    switch (os) {
      case 'darwin':
        return t(
          'auto.components.machines.cpu.temperatureHintMac',
          'Reading a Mac’s sensors needs the Xcode Command Line Tools on that Mac: run xcode-select --install there.'
        )
      case 'win32':
        return t(
          'auto.components.machines.cpu.temperatureHintWindows',
          'Windows shows no CPU temperature to an account without administrator rights here. Running LibreHardwareMonitor on that machine makes one readable.'
        )
      case 'linux':
      case null:
        return t(
          'auto.components.machines.cpu.temperatureHintLinux',
          'This machine exposes no CPU temperature sensor, as most virtual machines do not.'
        )
    }
  }
}

/** The processor's temperature as a headline figure; a dash where the machine has no readable sensor. */
export function MachineCpuTemperatureStat({
  metrics
}: {
  metrics: MachineMetrics | null
}): React.JSX.Element {
  const t = useTranslate()
  const missingSensorHint = useMissingSensorHint()
  const reading = metrics?.cpuTemperature
  const origin = reading
    ? [reading.source, reading.sensors[0]?.label].filter(Boolean).join(' · ')
    : undefined
  return (
    <div
      className="min-w-0"
      title={origin ?? (metrics ? missingSensorHint(metrics.os) : undefined)}
      data-machine-cpu-temperature={reading ? 'reading' : 'unavailable'}
    >
      <MachineResourceStat
        label={t('auto.components.machines.cpu.temperature', 'Temperature')}
        value={formatTemperature(reading?.temperatureC)}
        detail={
          origin ??
          (metrics
            ? t('auto.components.machines.cpu.temperatureUnavailable', 'no readable sensor')
            : undefined)
        }
      />
    </div>
  )
}

/** Every sensor behind the headline temperature: each core, or each die of a Ryzen. */
export function MachineCpuSensors({
  metrics
}: {
  metrics: MachineMetrics | null
}): React.JSX.Element | null {
  const t = useTranslate()
  const reading = metrics?.cpuTemperature
  if (!reading || reading.sensors.length < 2) {
    return null
  }
  return (
    <PageCard
      title={t('auto.components.machines.cpu.sensors', 'CPU sensors')}
      action={
        <span className="truncate text-2xs text-muted-foreground" title={reading.source}>
          {reading.source}
        </span>
      }
    >
      {/* Capped so the cores of a large processor do not push the processes out of sight. */}
      <dl
        className="scrollbar-sleek grid max-h-36 grid-cols-[repeat(auto-fill,minmax(min(11rem,100%),1fr))] gap-x-6 gap-y-1 overflow-y-auto p-3 text-2xs"
        data-machine-cpu-sensors={reading.sensors.length}
      >
        {reading.sensors.map((sensor) => (
          <MachineResourceFact
            key={sensor.label}
            label={sensor.label}
            value={formatTemperature(sensor.temperatureC)}
          />
        ))}
      </dl>
    </PageCard>
  )
}
