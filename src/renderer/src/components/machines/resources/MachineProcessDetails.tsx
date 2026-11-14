import React from 'react'
import { useTranslate } from '@/i18n/use-translate'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import type { MachineMetrics } from '../../../../../shared/machines/machine-types'
import { formatBytes } from '../model/machine-format'
import { MachineDockerSection } from './MachineDockerSection'
import { MachineProcessesView } from './MachineProcessesView'
import { MachineResourceStat, MachineResourceStats } from './MachineResourceStat'

export function MachineCpuDetail({
  machine,
  metrics
}: {
  machine: MachineSummary
  metrics: MachineMetrics | null
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <MachineProcessesView
      machine={machine}
      initialSort="cpu"
      summary={(snapshot) => (
        <MachineResourceStats>
          <MachineResourceStat
            label={t('auto.components.machines.cpu.busy', 'Busy now')}
            value={
              snapshot?.cpuBusyPercent === null || snapshot?.cpuBusyPercent === undefined
                ? '—'
                : `${snapshot.cpuBusyPercent.toFixed(1)}%`
            }
            detail={t('auto.components.machines.cpu.busyDetail', 'all cores, last second')}
          />
          <MachineResourceStat
            label={t('auto.components.machines.cpu.load', 'Load average')}
            value={metrics?.loadAverage?.map((load) => load.toFixed(2)).join('  ') ?? '—'}
            detail={t('auto.components.machines.cpu.loadDetail', '1, 5 and 15 minutes')}
          />
          <MachineResourceStat
            label={t('auto.components.machines.cpu.cores', 'Cores')}
            value={metrics?.cpuCount ? String(metrics.cpuCount) : '—'}
            detail={metrics?.cpuModel ?? undefined}
          />
          <MachineResourceStat
            label={t('auto.components.machines.cpu.processes', 'Processes')}
            value={snapshot ? String(snapshot.totalProcesses) : '—'}
          />
        </MachineResourceStats>
      )}
    />
  )
}

export function MachineMemoryDetail({
  machine,
  metrics
}: {
  machine: MachineSummary
  metrics: MachineMetrics | null
}): React.JSX.Element {
  const t = useTranslate()
  const total = metrics?.memTotalBytes ?? null
  const available = metrics?.memAvailableBytes ?? null
  return (
    <MachineProcessesView
      machine={machine}
      initialSort="memory"
      summary={(snapshot) => (
        <MachineResourceStats>
          <MachineResourceStat
            label={t('auto.components.machines.memory.used', 'Used')}
            value={total === null || available === null ? '—' : formatBytes(total - available)}
            detail={
              total === null
                ? undefined
                : t('auto.components.machines.memory.ofTotal', 'of {{total}}', {
                    total: formatBytes(total)
                  })
            }
          />
          <MachineResourceStat
            label={t('auto.components.machines.memory.available', 'Available')}
            value={formatBytes(available)}
          />
          <MachineResourceStat
            label={t('auto.components.machines.memory.swap', 'Swap')}
            value={
              snapshot?.swap
                ? snapshot.swap.totalBytes > 0
                  ? formatBytes(snapshot.swap.usedBytes)
                  : t('auto.components.machines.memory.noSwap', 'None')
                : '—'
            }
            detail={
              snapshot?.swap && snapshot.swap.totalBytes > 0
                ? t('auto.components.machines.memory.ofTotal', 'of {{total}}', {
                    total: formatBytes(snapshot.swap.totalBytes)
                  })
                : snapshot?.swap
                  ? t('auto.components.machines.memory.noSwapDetail', 'no swap configured')
                  : undefined
            }
          />
          <MachineResourceStat
            label={t('auto.components.machines.memory.processes', 'Processes')}
            value={snapshot ? String(snapshot.totalProcesses) : '—'}
          />
        </MachineResourceStats>
      )}
    >
      <MachineDockerSection machine={machine} />
    </MachineProcessesView>
  )
}
